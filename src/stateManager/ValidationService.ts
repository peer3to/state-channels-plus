import AgreementManager from "@/agreementManager";
import { ExecutionFlags, TimeConfig, AgreementFlag } from "@/types";
import { SignedBlockStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import DisputeHandler from "@/DisputeHandler";
import { ethers } from "ethers";
import { StateChannelManagerProxy } from "@typechain-types/contracts/V1/StateChannelDiamondProxy";
import {
    SignatureUtils,
    getActiveParticipants,
    Codec,
    Type,
    hash
} from "@/utils";
import AStateMachine from "@/AStateMachine";
import { Clock } from "..";
import ProofManager from "@/ProofManager";
import {
    Address,
    ChannelId,
    ForkId,
    Signature,
    Timestamp
} from "@/types/types";
import { Block } from "@/models";
import { SortOrder } from "@/storage/BlockStorage";
import Storage from "@/storage";

interface ValidationResult {
    success: boolean;
    flag: ExecutionFlags;
    agreementFlag?: AgreementFlag;
}

export default class ValidationService {
    constructor(
        private readonly storage: Storage,
        private readonly agreementManager: AgreementManager,
        private readonly stateMachine: AStateMachine,
        private readonly disputeHandler: DisputeHandler,
        private readonly scmContract: StateChannelManagerProxy,
        private readonly timeCfg: TimeConfig,
        /** getter keeps channelId reactive if StateManager changes it later */
        private readonly getChannelId: () => ChannelId,
        private readonly signerAddress: Address,
        private readonly onSignedBlock: (
            signedBlock: SignedBlockStruct,
            block?: Block
        ) => Promise<ExecutionFlags>
    ) {}

    /*──────────────────────── PUBLIC API ────────────────────────*/
    public async validateSignedBlock(
        signedBlock: SignedBlockStruct,
        block?: Block
    ): Promise<ValidationResult> {
        const blk = block ?? Block.decode(signedBlock.encodedBlock);

        if (!this.isChannelOpen()) return notReady();

        // Validate block
        if (!this.isSignedBlockAuthentic(signedBlock, blk, this.getChannelId()))
            return disconnect();

        // Check fork status
        if (
            this.isPastFork(blk.forkId) ||
            this.disputeHandler.isForkDisputed(blk.forkId)
        )
            return pastFork();

        // Check for duplicate blocks
        if (this.isBlockDuplicate(blk)) return duplicate();

        // Check for future blocks
        const isFutureFork = blk.forkId > this.getforkId();
        const isFutureTransaction = blk.height > this.getNextHeight();
        if (isFutureFork || isFutureTransaction) return notReady();

        // Check if participant is in the fork
        if (!this.agreementManager.isParticipantInLatestFork(blk.author))
            return disconnect();

        // Validate past block in current fork
        if (blk.height < this.getNextHeight()) {
            const agreementFlag = this.checkBlock(signedBlock);

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

        const { timestamp: previousTimestamp, previousBlock } =
            this.getPreviousTimestampAndBlock(blk);

        const isValidTimestamp =
            blk.timestamp >= previousTimestamp &&
            blk.timestamp <= previousTimestamp + this.timeCfg.p2pTime;

        // Objective timestamp validation
        if (!isValidTimestamp) {
            if (
                blk.height <= 0 || // genesis block
                previousBlock === undefined || // no previous block == genesis block
                previousBlock.onChainTimestamp !== undefined
            ) {
                // already has best timestamp
                // no point in trying to  update the timestamp => fraud proof
                const fraudProof =
                    this.disputeHandler.proofManager.createIncorrectDataProof(
                        signedBlock
                    );
                await this.disputeHandler.createDispute(blk.forkId, "0x00", 0, [
                    fraudProof
                ]);
                return dispute(AgreementFlag.INCORRECT_DATA);
            }

            // try to fetch later timestamp from on-chain data
            const onChainTimestamp =
                await this.fetchOnChainTimestamp(previousBlock);

            // Early return: Couldn't fetch or not better than current
            if (!onChainTimestamp || onChainTimestamp <= previousTimestamp) {
                const fraudProof =
                    this.disputeHandler.proofManager.createIncorrectDataProof(
                        signedBlock
                    );
                await this.disputeHandler.createDispute(blk.forkId, "0x00", 0, [
                    fraudProof
                ]);
                return dispute(AgreementFlag.INCORRECT_DATA);
            }

            // Update the previous block with the on-chain timestamp
            previousBlock.onChainTimestamp = onChainTimestamp;
            this.storage.blocks.setOnChainTimestamp(
                previousBlock.forkId,
                previousBlock.height,
                onChainTimestamp
            );

            // Re-validate with updated timestamp
            const isValidTimestamp =
                blk.timestamp >= onChainTimestamp &&
                blk.timestamp <= onChainTimestamp + this.timeCfg.p2pTime;

            if (!isValidTimestamp) {
                const fraudProof =
                    this.disputeHandler.proofManager.createIncorrectDataProof(
                        signedBlock
                    );
                await this.disputeHandler.createDispute(blk.forkId, "0x00", 0, [
                    fraudProof
                ]);
                return dispute(AgreementFlag.INCORRECT_DATA);
            }
            // If valid, continue with rest of validation
        }

        // Subjective timestamp validation (requireS)
        if (
            blk.onChainTimestamp === undefined ||
            blk.onChainTimestamp <= blk.timestamp
        ) {
            if (
                Math.abs(Clock.getTimeInSeconds() - blk.timestamp) >=
                this.timeCfg.agreementTime
            )
                return timestampTooOld();
        }

        // Validate block producer
        const nextToWrite = await this.stateMachine.getNextToWrite();
        if (blk.author !== nextToWrite)
            return dispute(AgreementFlag.INCORRECT_DATA);

        // All validation passed - return success
        return success();
    }

    public getPreviousTimestamp(blk: Block): Timestamp {
        const { timestamp } = this.getPreviousTimestampAndBlock(blk);
        return timestamp;
    }

    public getPreviousTimestampAndBlock(blk: Block): {
        timestamp: Timestamp;
        previousBlock?: Block;
    } {
        if (blk.height <= 0) {
            return {
                timestamp:
                    this.storage.stateSnapshots.getGenesisSnapshotDataByForkId(
                        blk.forkId
                    )!.timestamp
            };
        }

        const previousBlockEntry = this.storage.blocks.getBlockEntry(
            blk.forkId,
            blk.height - 1
        )!;
        const previousBlock = Block.decode(
            previousBlockEntry.blockConfirmation.signedBlock.encodedBlock
        );
        const timestamp = previousBlock.getRelevantTimestamp(
            blk.author,
            previousBlockEntry.blockConfirmation.signatures
        );

        return {
            timestamp,
            previousBlock
        };
    }

    public async validateBlockConfirmation(
        signed: SignedBlockStruct,
        confirmationSig: Signature,
        block?: Block
    ): Promise<ValidationResult> {
        const blk = block ?? Block.decode(signed.encodedBlock);

        if (!this.isChannelOpen()) return notReady();
        if (!this.isSignedBlockAuthentic(signed, blk, this.getChannelId()))
            return disconnect();
        if (this.isPastFork(blk.forkId)) return pastFork();

        // Ensure block in chain
        if (!this.isBlockInChain(blk)) {
            const flag = await this.onSignedBlock(signed, blk);

            if (flag === ExecutionFlags.DUPLICATE) {
                // Possibly it has become part of the chain now
                if (!this.isBlockInChain(blk)) {
                    return { success: false, flag: ExecutionFlags.NOT_READY };
                }
            } else if (flag !== ExecutionFlags.SUCCESS) {
                // If the processed result is anything else but SUCCESS, we must abort
                return { success: false, flag };
            }
        }

        /* confirmer inside fork */
        const confirmer = blk.getSignerAddress(confirmationSig);
        if (!this.agreementManager.isParticipantInLatestFork(confirmer))
            return disconnect();

        /* duplicate sig */
        if (this.agreementManager.doesSignatureExist(blk, confirmationSig))
            return duplicate();

        return success();
    }

    public async validateDispute(
        disputeStruct: DisputeStruct,
        timestamp: Timestamp
    ): Promise<boolean> {
        // triggered by StateManager.onDisputeCommitted, which is triggered by chain event 'DisputeCommitted'
        // therefore it is assumed that validation has already happened on

        // this is the place to add any validation that should run on a new dispute

        // Note: disputeIndex property doesn't exist on DisputeStruct, removing this validation
        // If dispute ordering validation is needed, it should be implemented differently

        const allowedParticipantsSet = await getActiveParticipants(
            this.scmContract,
            this.getChannelId()
        );
        if (!allowedParticipantsSet.has(disputeStruct.disputer)) {
            return false;
        }

        return true;
    }

    public async validateDisputeConfirmation(
        disputeStruct: DisputeStruct,
        confirmationSignature: Signature
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
                Codec.encode(disputeStruct, Type.Dispute),
                confirmationSignature
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

    /* Returns true if the block is in the chain (by hash and equality) */
    private isBlockInChain(block: Block): boolean {
        const blockEntry = this.storage.blocks.getBlockEntry(block.hash);
        return !!(
            blockEntry &&
            Block.decode(
                blockEntry.blockConfirmation.signedBlock.encodedBlock
            ).equals(block)
        );
    }

    /* Returns true if the block is in the chain or in the queue (duplicate) */
    private isBlockDuplicate(block: Block): boolean {
        if (this.isBlockInChain(block)) {
            return true;
        }
        // Check queue with dummy struct
        const dummyBlockConfirmation = {
            signedBlock: {
                encodedBlock: block.encode(),
                signature: "0x" // dummy signature, not used
            },
            signatures: []
        };
        if (
            this.storage.queues.isBlockQueued(dummyBlockConfirmation, {
                hash: block.hash
            })
        ) {
            return true;
        }
        return false;
    }

    private async fetchOnChainTimestamp(
        blk: Block
    ): Promise<Timestamp | undefined> {
        try {
            // Check if commitment exists on-chain
            const commitmentResult =
                await this.scmContract.getBlockCallDataCommitment(
                    this.getChannelId(),
                    blk.forkId,
                    blk.height,
                    blk.author
                );

            if (!commitmentResult.found) {
                return undefined;
            }

            // filter BlockCalldataPosted calls by channelId and author
            const filter = this.scmContract.filters.BlockCalldataPosted(
                this.getChannelId(),
                blk.author
            );

            // best will be to get exact block number from on-chain data
            // but idk how to AND it is added complexity
            // assumptoin here is that the block is within the recent 3 blocks (recent, recent-1, recent-2)
            const logs = await this.scmContract.queryFilter(
                filter,
                -2, // from block
                "latest" // to block
            );

            // Find matching log

            for (let i = logs.length - 1; i >= 0; i--) {
                const log = logs[i];
                if (hash(log.args.signedBlock.encodedBlock) === blk.hash) {
                    return Number(log.args.timestamp);
                }
            }
            return undefined;
        } catch (error) {
            console.error("Error fetching on-chain timestamp:", error);
            return undefined;
        }
    }

    /* one-liners */
    private getforkId(): ForkId {
        return this.agreementManager.getLatestforkId();
    }
    private isChannelOpen(): boolean {
        // Fix: Compare ForkId properly using ethers comparison
        const currentForkId = this.getforkId();
        return currentForkId !== ethers.ZeroHash && currentForkId !== "0x00";
    }
    private isPastFork(f: ForkId): boolean {
        // Fix: Use proper comparison for BytesLike types
        const currentForkId = this.getforkId();
        // This is a simplified comparison - in practice you may need more sophisticated fork comparison logic
        return f !== currentForkId;
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
        block: Block,
        expectedChannelId: ChannelId
    ): boolean {
        if (block.channelId !== expectedChannelId) return false;

        const h = ethers.keccak256(signed.encodedBlock);
        const signer = ethers.verifyMessage(
            ethers.getBytes(h),
            signed.signature as Signature
        );

        return signer === block.author;
    }

    /* Returns the latest block timestamp for a given fork */
    private getLatestBlockTimestamp(forkId: ForkId): Timestamp {
        // Get the genesis timestamp from the genesis snapshot
        const genesisSnapshot =
            this.storage.stateSnapshots.getGenesisSnapshotDataByForkId(forkId);
        const genesisTimestamp = genesisSnapshot.snapshot.timestamp;
        // Get all blocks for the fork in descending order
        const blocksIterator = this.storage.blocks.getIterator(
            forkId,
            SortOrder.DESC
        );
        const firstBlockEntry = blocksIterator.next().value;

        if (!firstBlockEntry) {
            return genesisTimestamp;
        }
        const block = Block.decode(
            firstBlockEntry.blockConfirmation.signedBlock.encodedBlock
        );

        return block.timestamp;
    }
    /* Returns the agreement flag for a given block after validation */
    private checkBlock(signed: SignedBlockStruct): AgreementFlag {
        const block = Block.decode(signed.encodedBlock);
        const { forkId, height } = block.coordinates;
        const participant = block.author;

        // 1 – valid signature?
        const signer = block.getSignerAddress(signed.signature);
        if (signer !== participant) return AgreementFlag.INVALID_SIGNATURE;

        // 2 – duplicate?
        if (this.isBlockDuplicate(block)) return AgreementFlag.DUPLICATE;

        // 3 – known fork?
        const genesisSnapshot =
            this.storage.stateSnapshots.getGenesisSnapshotDataByForkId(forkId);
        if (!genesisSnapshot) return AgreementFlag.NOT_READY;

        // 4 – double sign / incorrect data vs existing block
        const existingEntry = this.storage.blocks.getBlockEntry(forkId, height);
        if (existingEntry) {
            const existingBlock = Block.decode(
                existingEntry.blockConfirmation.signedBlock.encodedBlock
            );
            return existingBlock.author === participant
                ? AgreementFlag.DOUBLE_SIGN
                : AgreementFlag.INCORRECT_DATA;
        }

        // 5 – first block of fork genesis?
        if (height === 0) {
            // Get the expected previous block hash from the genesis snapshot
            // (Assume you have a way to get the encoded genesis state for the fork)
            const expectedPrev = ethers.keccak256(
                (genesisSnapshot as any).snapshot.snapshotData
                    .stateMachineStateHash
            );
            return block.previousBlockHash === expectedPrev
                ? AgreementFlag.READY
                : AgreementFlag.INCORRECT_DATA;
        }

        // 6 – compare with previous block in chain
        const prevEntry = this.storage.blocks.getBlockEntry(forkId, height - 1);
        if (!prevEntry) return AgreementFlag.NOT_READY;

        const prevBlock = Block.decode(
            prevEntry.blockConfirmation.signedBlock.encodedBlock
        );
        return prevBlock.hash === block.previousBlockHash
            ? AgreementFlag.READY
            : AgreementFlag.INCORRECT_DATA;
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
const timestampTooOld = (): ValidationResult => ({
    success: false,
    flag: ExecutionFlags.TIMESTAMP_TOO_OLD
});
const timestampTooFarInFuture = (): ValidationResult => ({
    success: false,
    flag: ExecutionFlags.TIMESTAMP_IN_FUTURE
});
const dispute = (af: AgreementFlag): ValidationResult => ({
    success: false,
    flag: ExecutionFlags.DISPUTE,
    agreementFlag: af
});
