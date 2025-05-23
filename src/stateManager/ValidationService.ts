import AgreementManager from "@/agreementManager";
import { ExecutionFlags, TimeConfig, AgreementFlag } from "@/types";
import {
    BlockStruct,
    SignedBlockStruct
} from "@typechain-types/contracts/V1/DataTypes";
import { DisputeStruct } from "@typechain-types/contracts/V1/DisputeTypes";
import DisputeHandler from "@/DisputeHandler";
import { AddressLike, BytesLike, ethers, SignatureLike } from "ethers";
import { AStateChannelManagerProxy } from "@typechain-types/contracts/V1/StateChannelDiamondProxy";
import {
    BlockUtils,
    EvmUtils,
    scheduleTask,
    subjectiveTimingFlag,
    SignatureUtils,
    getActiveParticipants
} from "@/utils";
import AStateMachine from "@/AStateMachine";
import { Clock } from "..";
import ProofManager from "@/ProofManager";
import { DisputeAuditingDataStruct } from "@typechain-types/contracts/V1/StateChannelManagerInterface";

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
        private readonly signerAddress: AddressLike,
        private readonly onSignedBlock: (
            signedBlock: SignedBlockStruct,
            block?: BlockStruct
        ) => Promise<ExecutionFlags>
    ) {}

    /*──────────────────────── PUBLIC API ────────────────────────*/
    public async validateSignedBlock(
        signedBlock: SignedBlockStruct,
        block?: BlockStruct
    ): Promise<ValidationResult> {
        const blk = block ?? EvmUtils.decodeBlock(signedBlock.encodedBlock);
        const forkCnt = BlockUtils.getFork(blk);
        const height = BlockUtils.getHeight(blk);

        if (!this.isChannelOpen()) return notReady();

        // Validate block
        if (!this.isSignedBlockAuthentic(signedBlock, blk, this.getChannelId()))
            return disconnect();

        // Check fork status
        if (
            this.isPastFork(forkCnt) ||
            this.disputeHandler.isForkDisputed(forkCnt)
        )
            return pastFork();

        // Check for duplicate blocks
        if (this.agreementManager.isBlockDuplicate(blk)) return duplicate();

        // Check for future blocks
        const isFutureFork = forkCnt > this.getForkCnt();
        const isFutureTransaction = height > this.getNextHeight();
        if (isFutureFork || isFutureTransaction) return notReady();

        // Check if participant is in the fork
        if (
            !this.agreementManager.isParticipantInLatestFork(
                BlockUtils.getBlockAuthor(blk)
            )
        )
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
        if (!(await this.isGoodTimestamp(blk)))
            return dispute(AgreementFlag.INCORRECT_DATA);

        // Check if enough time has passed
        const timeFlag = await this.isEnoughTimeSubjective(signedBlock, blk);
        if (timeFlag !== ExecutionFlags.SUCCESS) {
            return { success: false, flag: timeFlag };
        }

        // Validate block producer
        const nextToWrite = await this.stateMachine.getNextToWrite();
        if (BlockUtils.getBlockAuthor(blk) !== nextToWrite)
            return dispute(AgreementFlag.INCORRECT_DATA);

        // Process state transition
        return this.processStateTransition(blk, signedBlock);
    }

    public async validateBlockConfirmation(
        signed: SignedBlockStruct,
        confirmationSignature: BytesLike,
        block?: BlockStruct
    ): Promise<ValidationResult> {
        const blk = block ?? EvmUtils.decodeBlock(signed.encodedBlock);

        if (!this.isChannelOpen()) return notReady();
        if (!this.isSignedBlockAuthentic(signed, blk, this.getChannelId()))
            return disconnect();
        if (this.isPastFork(BlockUtils.getFork(signed))) return pastFork();

        // Ensure block in chain
        if (!this.agreementManager.isBlockInChain(signed)) {
            const flag = await this.onSignedBlock(signed, blk);

            if (flag === ExecutionFlags.DUPLICATE) {
                // Possibly it has become part of the chain now
                if (!this.agreementManager.isBlockInChain(signed)) {
                    return { success: false, flag: ExecutionFlags.NOT_READY };
                }
            } else if (flag !== ExecutionFlags.SUCCESS) {
                // If the processed result is anything else but SUCCESS, we must abort
                return { success: false, flag };
            }
        }

        /* confirmer inside fork */
        const confirmer = SignatureUtils.getSignerAddress(
            signed.encodedBlock,
            confirmationSignature as SignatureLike
        );
        if (!this.agreementManager.isParticipantInLatestFork(confirmer))
            return disconnect();

        /* duplicate sig */
        if (
            this.agreementManager.doesSignatureExist(
                EvmUtils.decodeBlock(signed.encodedBlock),
                confirmationSignature as SignatureLike
            )
        )
            return duplicate();

        return success();
    }

    public async validateDispute(
        disputeStruct: DisputeStruct,
        disputeAuditingData: DisputeAuditingDataStruct
    ): Promise<boolean> {
        // triggered by StateManager.onDisputeCommitted, which is triggered by chain event 'DisputeCommitted'
        // therefore it is assumed that validation has already happened on

        // this is the place to add any validation that should run on a new dispute

        if (
            disputeStruct.disputeIndex !==
            this.agreementManager.forks.getDisputesCount()
        ) {
            return false;
        }

        const allowedParticipantsSet = await getActiveParticipants(
            this.scmContract,
            this.getChannelId()
        );
        if (!allowedParticipantsSet.has(disputeStruct.disputer as string)) {
            return false;
        }

        return true;
    }

    public async validateDisputeConfirmation(
        disputeStruct: DisputeStruct,
        confirmationSignature: BytesLike
    ): Promise<ValidationResult> {
        if (!this.isChannelOpen()) return notReady();

        // Check if dispute exists
        if (!this.agreementManager.isDisputeKnown(disputeStruct)) {
            // Dispute not found - could be gossip arrived before event
            // Return NOT_READY to allow retry
            return notReady();
        }

        // Validate signature
        let confirmer;
        try {
            confirmer = SignatureUtils.getSignerAddress(
                disputeStruct,
                confirmationSignature as SignatureLike
            );
        } catch (error) {
            return dispute(AgreementFlag.INVALID_SIGNATURE);
        }

        // Check if participant already signed with a different signature
        const hasParticipantSigned =
            this.agreementManager.hasParticipantSignedDispute(
                disputeStruct,
                confirmer
            );

        if (hasParticipantSigned) {
            return duplicate();
        }

        const allowedParticipantsSet = await getActiveParticipants(
            this.scmContract,
            this.getChannelId()
        );

        if (confirmer === disputeStruct.disputer) {
            return dispute(AgreementFlag.DOUBLE_SIGN);
        }

        if (!allowedParticipantsSet.has(confirmer)) {
            return dispute(AgreementFlag.INVALID_SIGNATURE);
        }

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

    /* subjective time window */
    private async isEnoughTimeSubjective(
        signed: SignedBlockStruct,
        blk: BlockStruct
    ): Promise<ExecutionFlags> {
        if (!(await this.isMyTurn())) return ExecutionFlags.SUCCESS;

        const flag = subjectiveTimingFlag(
            BlockUtils.getTimestamp(blk),
            Clock.getTimeInSeconds()
        );
        if (flag === ExecutionFlags.DISPUTE) {
            const proof = ProofManager.createBlockTooFarInFutureProof(signed);
            this.disputeHandler.createDispute(this.getForkCnt(), "0x00", 0, [
                proof
            ]);
        }
        return flag;
    }

    /* objective / chain timestamp */
    private async isGoodTimestamp(blk: BlockStruct): Promise<boolean> {
        const forkCnt = BlockUtils.getFork(blk);
        const blockHeight = BlockUtils.getHeight(blk);
        const blockTimestamp = BlockUtils.getTimestamp(blk);

        const latestTxTs =
            this.agreementManager.getLatestBlockTimestamp(forkCnt);
        const initialReferenceTime = this.agreementManager.getLatestTimestamp(
            forkCnt,
            blockHeight
        );

        if (blockTimestamp < latestTxTs) throw new Error("Not implemented");

        if (blockTimestamp > initialReferenceTime + this.timeCfg.p2pTime) {
            const chainTs = Number(
                await this.scmContract.getChainLatestBlockTimestamp(
                    this.getChannelId(),
                    forkCnt,
                    blockHeight
                )
            );
            const updatedReferenceTime = Math.max(
                initialReferenceTime,
                chainTs
            );

            if (blockTimestamp > updatedReferenceTime + this.timeCfg.p2pTime)
                return false;
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

    private isSignedBlockAuthentic(
        signed: SignedBlockStruct,
        block: BlockStruct,
        expectedChannelId: BytesLike
    ): boolean {
        if (BlockUtils.getChannelId(block) !== expectedChannelId) return false;

        const h = ethers.keccak256(signed.encodedBlock);
        const signer = ethers.verifyMessage(
            ethers.getBytes(h),
            signed.signature as SignatureLike
        );

        return signer === BlockUtils.getBlockAuthor(block);
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
