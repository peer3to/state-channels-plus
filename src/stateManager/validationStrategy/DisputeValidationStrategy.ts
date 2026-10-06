import AValidationStrategy, {
    ParticipantSnapshots
} from "./AValidationStrategy";
import DisputeFraudProofService from "../dispute/DisputeFraudProofService";
import type DisputeValidationService from "../dispute/DisputeValidationService";
import FraudProofService from "../utils/FraudProofService";
import { Block } from "@/models";

import Storage from "@/storage";
import type {
    BlockPredecessor,
    QueuedBlockEntry
} from "@/storage/QueueStorage";
import { BlockValidationResult, Hash, Signature } from "@/types";
import { Logger } from "@/utils";
import {
    BlockConfirmationStruct,
    MessageBlockStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";

export default class DisputeValidationStrategy extends AValidationStrategy {
    readonly fraudProofService: FraudProofService;
    readonly disputeFraudProofService: DisputeFraudProofService;
    private readonly logger: Logger;
    /** The chain did not make the failing block challengeable. */
    public isIneligible = false;

    constructor(
        private readonly storage: Storage,
        private readonly dispute: DisputeStruct,
        /** the replayed block's position in the dispute's last milestone */
        private readonly blockIndex: number,
        /** what the replayed block is judged from, on the dispute's own chain */
        private readonly predecessor: BlockPredecessor,
        private readonly disputeValidation: Pick<
            DisputeValidationService,
            "isBlockChallengeEligible"
        >,
        /**
         * Only a replay from the chain's anchor establishes a fault: a lower
         * tier's failure falls through to the next tier, so it builds no proof.
         */
        private readonly establishesFault: boolean,
        logger: Logger
    ) {
        super();
        this.logger = logger.child({ component: "DisputeValidation" });
        this.fraudProofService = new FraudProofService(
            this.storage,
            this.logger
        );
        this.disputeFraudProofService = new DisputeFraudProofService(
            this.storage,
            this.logger
        );
    }

    // Dispute replay audits a fixed proof out of live order on the disputed
    // fork, so it enforces neither live gate and skips the disputed-fork lookup.
    public get enforcesLiveForkAndOrderingGates(): boolean {
        return false;
    }

    /**
     * Stores a block allegation. The chain-tier replay starts at the first
     * block the chain makes eligible; for a block the chain protects nothing
     * is built or stored and the caller checks whether the anchor advanced.
     * A lower tier only reports the failure.
     */
    private async allege(store: () => void): Promise<BlockValidationResult> {
        if (!this.establishesFault) return BlockValidationResult.DISPUTE;
        const isEligible =
            await this.disputeValidation.isBlockChallengeEligible(
                this.dispute,
                this.blockIndex
            );
        if (!isEligible) {
            this.isIneligible = true;
            return BlockValidationResult.DISPUTE;
        }
        store();
        return BlockValidationResult.DISPUTE;
    }

    /** Builds the block fraud proof only where it establishes the fault. */
    private async applyFraudProof(
        createFraudProof: () => Hash
    ): Promise<BlockValidationResult> {
        return this.allege(() => {
            const fraudProof =
                this.storage.fraudProofs.getFraudProofByHash(
                    createFraudProof()
                )!;
            this.disputeFraudProofService.createDisputeInvalidBlockInStateProofApplyFraudProof(
                this.dispute,
                fraudProof,
                this.blockIndex
            );
        });
    }

    public async interpretFinalValidationResult(
        blockValidationResult: BlockValidationResult
    ): Promise<boolean> {
        switch (blockValidationResult) {
            case BlockValidationResult.SUCCESS:
            case BlockValidationResult.DUPLICATE:
                // do nothing, do not disconnect
                return true;
            case BlockValidationResult.DISPUTE:
                return false;
            default:
                throw new Error(
                    `${BlockValidationResult[blockValidationResult] ?? "Unknown BlockValidationResult"} result in DisputeValidationStrategy`
                );
        }
    }
    public async authenticateBlockFailed(
        _block: BlockConfirmationStruct
    ): Promise<BlockValidationResult> {
        // the canonical structure check of the last milestone already passed
        return BlockValidationResult.SUCCESS;
    }
    public async wrongChannel(_block: Block): Promise<BlockValidationResult> {
        throw new Error(
            "DisputeValidationStrategy - wrongChannel should not be called"
        );
    }
    public async channelNotOpened(
        _entry: QueuedBlockEntry
    ): Promise<BlockValidationResult> {
        throw new Error(
            "DisputeValidationStrategy - channelNotOpened should not be called"
        );
    }
    public async malformedConfirmationSignatures(
        entry: QueuedBlockEntry,
        signatures: Set<Signature>
    ): Promise<BlockValidationResult> {
        entry.block.removeConfirmationSignatures(signatures);
        return BlockValidationResult.SUCCESS;
    }

    public async notAllSingersAreParticipants(
        entry: QueuedBlockEntry,
        unexpectedSignatures: Set<Signature>,
        participantSnapshots?: ParticipantSnapshots
    ): Promise<BlockValidationResult> {
        const block = entry.block;
        if (unexpectedSignatures.has(block.originalSignature)) {
            // The outsider author can't be slashed, but the dispute submitter
            // (a union member) packaged this block into the stateProof — kill
            // the dispute with evidence against the submitter. No transport
            // punishment: these blocks are replayed from a proof, not gossiped.
            // The ingest pipeline always passes the snapshots it executed.
            if (!participantSnapshots)
                throw new Error(
                    "DisputeValidationStrategy - notAllSingersAreParticipants needs the executed participant snapshots"
                );
            return this.allege(() =>
                this.disputeFraudProofService.createDisputeBlockAuthorNotParticipant(
                    this.dispute,
                    this.predecessor,
                    participantSnapshots.resulting,
                    this.blockIndex
                )
            );
        }
        // Stray confirmation signatures don't invalidate the replayed block.
        block.removeConfirmationSignatures(unexpectedSignatures);
        return BlockValidationResult.SUCCESS;
    }
    public async noNewSignaturesOnExistingBlock(
        _block: Block
    ): Promise<BlockValidationResult> {
        return BlockValidationResult.DUPLICATE;
    }
    public async goodNewSignaturesOnExistingBlock(
        block: Block
    ): Promise<BlockValidationResult> {
        // Store new signatures and success
        this.storage.blocks.storeBlock(block);
        return BlockValidationResult.DUPLICATE;
    }
    public async blockAuthorIsNotParticipant(
        entry: QueuedBlockEntry
    ): Promise<BlockValidationResult> {
        const block = entry.block;
        const resultingStateSnapshot =
            this.storage.stateSnapshots.getStateSnapshotByHash(
                block.stateSnapshotHash
            );
        // the resulting snapshot is not held yet: the replay executes the
        // block and the participant-union check judges the author
        if (!resultingStateSnapshot) return BlockValidationResult.SUCCESS;
        return this.allege(() =>
            this.disputeFraudProofService.createDisputeBlockAuthorNotParticipant(
                this.dispute,
                this.predecessor,
                resultingStateSnapshot,
                this.blockIndex
            )
        );
    }
    public async doubleSignDetected(
        conflictingBlock: Block,
        block: Block
    ): Promise<BlockValidationResult> {
        // Create and apply normal fraud proof to slash the offender + DEFER creating a new dispute - this dispute may still be honest, so continute validation
        this.fraudProofService.createDoubleSignProof(conflictingBlock, block);
        // TODO - apply the fraud proof without creating a new dispute
        return BlockValidationResult.SUCCESS; // so we continue 'syncing' and checking new blocks
    }
    public async invalidStateTransitionDetected(
        block: Block
    ): Promise<BlockValidationResult> {
        return this.applyFraudProof(() =>
            this.fraudProofService.createInvalidStateTransitionProof(
                block,
                this.predecessor
            )
        );
    }
    public async wrongGenesisDetected(
        entry: QueuedBlockEntry
    ): Promise<BlockValidationResult> {
        const block = entry.block;
        // Invariant: by the time a state-proof block reaches this dispute path,
        // the upstream Solidity header-mismatch check has already killed any
        // wrong-fork dispute, so block[0] is on the disputed fork and its
        // genesis snapshot MUST be present. A missing one is a bug, not a peer
        // fault - fail loudly rather than silently mis-proving.
        if (
            !this.storage.stateSnapshots.getGenesisSnapshotByForkId(
                block.forkId
            )
        ) {
            throw new Error("Unexpected genesisSnapshot missing");
        }
        return this.applyFraudProof(() =>
            this.fraudProofService.createWrongGenesisProof(block)
        );
    }
    public async forgedInboundMessageBlockDetected(
        block: Block,
        messageBlock: MessageBlockStruct
    ): Promise<BlockValidationResult> {
        return this.applyFraudProof(() =>
            this.fraudProofService.createForgedInboundMessageBlockProof(
                block,
                messageBlock
            )
        );
    }
    public async conflictingButNotLinkedBlockDetected(
        _entry: QueuedBlockEntry
    ): Promise<BlockValidationResult> {
        // The block extends another history than the one stored at its
        // height; the replay judges it from its own predecessor.
        return BlockValidationResult.SUCCESS;
    }
    public async blockForkIsDisputed(
        _entry: QueuedBlockEntry
    ): Promise<BlockValidationResult> {
        // Guarded by enforcesLiveForkAndOrderingGates: dispute replay never
        // reaches the disputed-fork gate (it audits the disputed fork itself).
        throw new Error(
            "DisputeValidationStrategy - blockForkIsDisputed should not be called"
        );
    }
    public async blockIsBelowInstalledHistory(
        _entry: QueuedBlockEntry
    ): Promise<BlockValidationResult> {
        throw new Error(
            "Dispute replay cannot reach the missing-old-block gate"
        );
    }

    public async blockIsNotNextAndIsInTheFuture(
        _entry: QueuedBlockEntry
    ): Promise<BlockValidationResult> {
        // Guarded by enforcesLiveForkAndOrderingGates: dispute replay never
        // reaches the future-block gate (it walks a proof out of live order).
        throw new Error(
            "DisputeValidationStrategy - blockIsNotNextAndIsInTheFuture should not be called"
        );
    }
    public async blockIsNotLinkedAndIsNotFirstBlock(
        _entry: QueuedBlockEntry
    ): Promise<BlockValidationResult> {
        // The replay judges each block from the previous block of the
        // structure-checked run, so a replayed block is always linked.
        throw new Error(
            "DisputeValidationStrategy - blockIsNotLinkedAndIsNotFirstBlock should not be called"
        );
    }
    public async objectiveInvalidTimestampDetected(
        block: Block
    ): Promise<BlockValidationResult> {
        // TODO - think about this - can this change over time? i.e. can onChainTimestamp or the presence of calldata change things
        return this.applyFraudProof(() =>
            this.fraudProofService.createInvalidTimestampProof(
                block,
                this.predecessor
            )
        );
    }
    public async subjectiveInvalidTimestampDetected(
        _block: Block
    ): Promise<BlockValidationResult> {
        // This is not relevant here - just continue and accept the block
        return BlockValidationResult.SUCCESS;
    }
}
