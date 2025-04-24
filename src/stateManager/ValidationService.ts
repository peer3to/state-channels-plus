import AgreementManager, { AgreementFlag } from "@/AgreementManager";
import { ExecutionFlags, TimeConfig } from "@/DataTypes";
import {
    BlockStruct,
    SignedBlockStruct
} from "@typechain-types/contracts/V1/DataTypes";
import DisputeHandler from "@/DisputeHandler";
import { AddressLike, BytesLike, ethers, SignatureLike } from "ethers";
import { AStateChannelManagerProxy } from "@typechain-types/contracts/V1/StateChannelDiamondProxy";
import {
    forkOf,
    heightOf,
    participantOf,
    timestampOf
} from "@/utils/BlockUtils";
import AStateMachine from "@/AStateMachine";
import EvmUtils from "@/utils/EvmUtils";
import { scheduleTask } from "@/utils/scheduler";
import { Clock } from "..";

interface ValidationResult {
    success: boolean;
    flag: ExecutionFlags;
    agreementFlag?: AgreementFlag;
}

export default class ValidationService {
    constructor(
        private readonly agreementManager: AgreementManager,
        private readonly stateMachine: AStateMachine,
        private readonly disputeHandler: DisputeHandler,
        private readonly scmContract: AStateChannelManagerProxy,
        private readonly timeCfg: TimeConfig,
        /** getter keeps channelId reactive if StateManager changes it later */
        private readonly getChannelId: () => BytesLike,
        private readonly signerAddress: AddressLike
    ) {}

    /*──────────────────────── PUBLIC API ────────────────────────*/
    public async validateSignedBlock(
        signedBlock: SignedBlockStruct,
        sblock?: BlockStruct
    ): Promise<ValidationResult> {
        const b = sblock ?? EvmUtils.decodeBlock(signedBlock.encodedBlock);
        const forkCnt = forkOf(b);
        const height = heightOf(b);

        if (!this.isChannelOpen()) return notReady();

        // Validate block
        if (!(await this.isValidBlock(signedBlock, b))) return disconnect();

        // Check fork status
        if (
            this.isPastFork(forkCnt) ||
            this.disputeHandler.isForkDisputed(forkCnt)
        )
            return pastFork();

        // Check for duplicate blocks
        if (this.agreementManager.isBlockDuplicate(b)) return duplicate();

        // Check for future blocks
        const isFutureFork = forkCnt > this.getForkCnt();
        const isFutureTransaction = height > this.getNextHeight();
        if (isFutureFork || isFutureTransaction) return notReady();

        // Check if participant is in the fork
        if (!this.agreementManager.isParticipantInLatestFork(participantOf(b)))
            return disconnect();

        // Validate past block in current fork
        if (height < this.getNextHeight()) {
            const agreementFlag = this.agreementManager.checkBlock(signedBlock);

            if (
                agreementFlag === AgreementFlag.DOUBLE_SIGN ||
                agreementFlag === AgreementFlag.INCORRECT_DATA
            ) {
                return dispute(agreementFlag);
            }

            throw new Error(
                "StateManager - OnSignedBlock - current fork in the past - INTERNAL ERROR"
            );
        }

        // Validate timestamp
        if (!(await this.isGoodTimestamp(b)))
            return dispute(AgreementFlag.INCORRECT_DATA);

        // Check if enough time has passed
        const timeFlag = await this.isEnoughTimeSubjective(signedBlock);
        if (timeFlag !== ExecutionFlags.SUCCESS) {
            return { success: false, flag: timeFlag };
        }

        // Validate block producer
        const nextToWrite = await this.stateMachine.getNextToWrite();
        if (participantOf(b) !== nextToWrite)
            return dispute(AgreementFlag.INCORRECT_DATA);

        // Process state transition
        return this.processStateTransition(b, signedBlock);
    }

    public async validateBlockConfirmation(
        signed: SignedBlockStruct,
        confirmationSig: BytesLike,
        block?: BlockStruct
    ): Promise<ValidationResult> {
        const blk = block ?? EvmUtils.decodeBlock(signed.encodedBlock);

        if (!this.isChannelOpen()) return notReady();
        if (!(await this.isValidBlock(signed, blk))) return disconnect();
        if (this.isPastFork(forkOf(blk))) return pastFork();

        /* bring block into chain if needed */
        if (!this.agreementManager.isBlockInChain(blk)) {
            const res = await this.validateSignedBlock(signed, blk);
            if (
                res.flag !== ExecutionFlags.SUCCESS &&
                res.flag !== ExecutionFlags.DUPLICATE
            )
                return res;
            if (!this.agreementManager.isBlockInChain(blk)) return notReady();
        }

        /* confirmer inside fork */
        const confirmer = EvmUtils.retrieveSignerAddressBlock(
            blk,
            confirmationSig as SignatureLike
        );
        if (!this.agreementManager.isParticipantInLatestFork(confirmer))
            return disconnect();

        /* duplicate sig */
        if (
            this.agreementManager.doesSignatureExist(
                blk,
                confirmationSig as SignatureLike
            )
        )
            return duplicate();

        this.agreementManager.confirmBlock(
            blk,
            confirmationSig as SignatureLike
        );
        return success();
    }

    /*────────────────────── PRIVATE HELPERS ─────────────────────*/

    private async processStateTransition(
        block: BlockStruct,
        signed: SignedBlockStruct
    ): Promise<ValidationResult> {
        const previousStateHash = await this.stateMachine
            .getState()
            .then(ethers.keccak256);
        let { success: txOK, successCallback } =
            await this.stateMachine.stateTransition(block.transaction);

        const encodedState = await this.stateMachine.getState();
        const stateHash = ethers.keccak256(encodedState);

        const hashOK =
            stateHash === block.stateHash &&
            previousStateHash === block.previousStateHash;

        if (!txOK || !hashOK) return dispute(AgreementFlag.INCORRECT_DATA);

        this.agreementManager.addBlock(
            block,
            signed.signature as SignatureLike,
            encodedState
        );
        scheduleTask(successCallback, 0, "stateTransitionSuccessCallback");
        return success();
    }

    private async isValidBlock(
        signed: SignedBlockStruct,
        blk: BlockStruct
    ): Promise<boolean> {
        if (blk.transaction.header.channelId !== this.getChannelId())
            return false;

        const blockHash = ethers.keccak256(signed.encodedBlock);
        return (
            ethers.verifyMessage(
                ethers.getBytes(blockHash),
                signed.signature as SignatureLike
            ) === blk.transaction.header.participant
        );
    }

    /* subjective time window */
    private async isEnoughTimeSubjective(
        signed: SignedBlockStruct
    ): Promise<ExecutionFlags> {
        if (!(await this.isMyTurn())) return ExecutionFlags.SUCCESS;

        const blk = EvmUtils.decodeBlock(signed.encodedBlock);
        const flag = this.checkSubjectiveTiming(blk);
        if (flag === ExecutionFlags.DISPUTE) {
            const proof =
                this.disputeHandler.createBlockTooFarInFutureProof(signed);
            this.disputeHandler.createDispute(this.getForkCnt(), "0x00", 0, [
                proof
            ]);
        }
        return flag;
    }
    private checkSubjectiveTiming(blk: BlockStruct): ExecutionFlags {
        const now = BigInt(Clock.getTimeInSeconds());
        const ts = BigInt(blk.transaction.header.timestamp);
        if (ts + 5n < now) return ExecutionFlags.NOT_ENOUGH_TIME;
        if (ts - 10n > now) return ExecutionFlags.DISPUTE;
        return ExecutionFlags.SUCCESS;
    }

    /* objective / chain timestamp */
    private async isGoodTimestamp(blk: BlockStruct): Promise<boolean> {
        const ts = timestampOf(blk);
        const latestTx = this.agreementManager.getLatestBlockTimestamp(
            this.getForkCnt()
        );
        let referenceTime = this.agreementManager.getLatestTimestamp(
            forkOf(blk),
            heightOf(blk)
        );

        if (ts < latestTx) throw new Error("Backwards timestamp");

        if (ts > referenceTime + this.timeCfg.p2pTime) {
            const chainTs = Number(
                await this.scmContract.getChainLatestBlockTimestamp(
                    this.getChannelId(),
                    forkOf(blk),
                    heightOf(blk)
                )
            );
            if (chainTs > referenceTime) referenceTime = chainTs;
            if (ts > referenceTime + this.timeCfg.p2pTime) return false;
        }
        return true;
    }

    /* one-liners */
    private getForkCnt(): number {
        return this.agreementManager.getLatestForkCnt();
    }
    private isChannelOpen(): boolean {
        return this.getForkCnt() >= 0;
    }
    private isPastFork(f: number): boolean {
        return f < this.getForkCnt();
    }
    private getNextHeight(): number {
        return this.agreementManager.getNextBlockHeight();
    }

    private async isMyTurn(): Promise<boolean> {
        return (
            (await this.stateMachine.getNextToWrite()) === this.signerAddress
        );
    }
}

/* small helpers for clarity */
const success = (): ValidationResult => ({
    success: true,
    flag: ExecutionFlags.SUCCESS
});
const notReady = (): ValidationResult => ({
    success: false,
    flag: ExecutionFlags.NOT_READY
});
const pastFork = (): ValidationResult => ({
    success: false,
    flag: ExecutionFlags.PAST_FORK
});
const duplicate = (): ValidationResult => ({
    success: false,
    flag: ExecutionFlags.DUPLICATE
});
const disconnect = (): ValidationResult => ({
    success: false,
    flag: ExecutionFlags.DISCONNECT
});
const dispute = (af: AgreementFlag): ValidationResult => ({
    success: false,
    flag: ExecutionFlags.DISPUTE,
    agreementFlag: af
});
