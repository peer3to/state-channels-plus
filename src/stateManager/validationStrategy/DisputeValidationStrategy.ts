import { Block } from "@/models";
import { BlockValidationResult, Hash, Signature } from "@/types";
import { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";

import AValidationStrategy, {
    ParticipantSnapshots
} from "./AValidationStrategy";
import type { QueuedBlockEntry } from "@/storage/QueueStorage";
import FraudProofService from "../utils/FraudProofService";
import Storage from "@/storage";
import DisputeFraudProofService from "../utils/DisputeFraudProofService";
import {
    BlockConfirmationStruct,
    MessageBlockStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { Logger } from "@/utils";
import { LocalDiamond } from "@typechain-types";

export default class DisputeValidationStrategy extends AValidationStrategy {
    readonly fraudProofService: FraudProofService;
    readonly disputeFraudProofService: DisputeFraudProofService;
    private readonly logger: Logger;

    constructor(
        private readonly storage: Storage,
        private readonly dispute: DisputeStruct,
        private readonly blockIndexInUnfinalizedPartOfStateProof: number,
        private readonly localDiamondContract: LocalDiamond,
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

    private createDisputeInvalidBlockInStateProofApplyFraudProof(
        fraudProofHash: Hash
    ): void {
        const fraudProof =
            this.storage.fraudProofs.getFraudProofByHash(fraudProofHash)!;
        this.disputeFraudProofService.createDisputeInvalidBlockInStateProofApplyFraudProof(
            this.dispute,
            fraudProof,
            this.blockIndexInUnfinalizedPartOfStateProof
        );
    }

    private async handleInvalidBlockStructure(): Promise<BlockValidationResult> {
        const isInvalid =
            await this.localDiamondContract.isInvalidBlockStructureInStateProof.staticCall(
                this.dispute.input.stateProof,
                this.blockIndexInUnfinalizedPartOfStateProof
            );
        // Reaching this strategy hook means the off-chain replay observed an
        // authentication or linkage deviation. That observation alone cannot
        // kill a dispute: the committed stateProof must satisfy the canonical
        // Solidity fraud-proof predicate that will also run on-chain. A local
        // linkage deviation can, for example, come from a missing local
        // baseline while the blocks committed inside the proof remain linked.
        // In that case this proof type does not apply, so SUCCESS means
        // "continue replay", not "the dispute is valid". A later transition,
        // snapshot, or other authoritative check must make the final decision.
        if (!isInvalid) return BlockValidationResult.SUCCESS;
        this.disputeFraudProofService.createDisputeInvalidBlockStructure(
            this.dispute,
            this.blockIndexInUnfinalizedPartOfStateProof
        );
        return BlockValidationResult.DISPUTE;
    }

    public async interpretFinalValidationResult(
        blockValidationResult: BlockValidationResult
    ): Promise<boolean> {
        switch (blockValidationResult) {
            case BlockValidationResult.SUCCESS:
                // do nothing, do not disconnect
                return true;
            case BlockValidationResult.NOT_READY:
                throw new Error(
                    "NOT_READY result in DisputeValidationStrategy"
                );
            case BlockValidationResult.DUPLICATE:
                return true;
            case BlockValidationResult.NOT_ENOUGH_TIME:
                throw new Error(
                    "NOT_ENOUGH_TIME result in DisputeValidationStrategy"
                );
            case BlockValidationResult.DISCONNECT:
                throw new Error(
                    "DISCONNECT result in DisputeValidationStrategy"
                );
            case BlockValidationResult.BROADCAST:
                throw new Error(
                    "BROADCAST result in DisputeValidationStrategy"
                );
            case BlockValidationResult.DISPUTE:
                return false;
            default:
                throw new Error(
                    "Unknown BlockValidationResult in DisputeValidationStrategy"
                );
        }
    }
    public async authenticateBlockFailed(
        _block: BlockConfirmationStruct
    ): Promise<BlockValidationResult> {
        return this.handleInvalidBlockStructure();
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
            if (!participantSnapshots) {
                this.logger.debug(
                    "Skipping dispute outsider-author proof because participant snapshots are unavailable",
                    { blockHash: block.hash, path: "signature-union" }
                );
                return BlockValidationResult.SUCCESS;
            }
            this.disputeFraudProofService.createDisputeBlockAuthorNotParticipant(
                this.dispute,
                block,
                participantSnapshots.previous,
                participantSnapshots.resulting,
                this.blockIndexInUnfinalizedPartOfStateProof
            );
            return BlockValidationResult.DISPUTE;
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
        const previousStateSnapshot = this.storage.getPreviousStateSnapshot(
            block.coordinates
        );
        const resultingStateSnapshot =
            this.storage.stateSnapshots.getStateSnapshotByHash(
                block.stateSnapshotHash
            );
        if (!previousStateSnapshot || !resultingStateSnapshot) {
            this.logger.debug(
                "Skipping dispute outsider-author proof because participant snapshots are unavailable",
                {
                    blockHash: block.hash,
                    path: "early-author",
                    previousSnapshotFound: previousStateSnapshot !== undefined,
                    resultingSnapshotFound: resultingStateSnapshot !== undefined
                }
            );
            return BlockValidationResult.SUCCESS;
        }
        this.disputeFraudProofService.createDisputeBlockAuthorNotParticipant(
            this.dispute,
            block,
            previousStateSnapshot,
            resultingStateSnapshot,
            this.blockIndexInUnfinalizedPartOfStateProof
        );
        return BlockValidationResult.DISPUTE;
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
        const hash =
            this.fraudProofService.createInvalidStateTransitionProof(block);
        this.createDisputeInvalidBlockInStateProofApplyFraudProof(hash);
        return BlockValidationResult.DISPUTE;
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
        const hash = this.fraudProofService.createWrongGenesisProof(block);
        this.createDisputeInvalidBlockInStateProofApplyFraudProof(hash);
        return BlockValidationResult.DISPUTE;
    }
    public async forgedInboundMessageBlockDetected(
        block: Block,
        messageBlock: MessageBlockStruct
    ): Promise<BlockValidationResult> {
        const hash =
            this.fraudProofService.createForgedInboundMessageBlockProof(
                block,
                messageBlock
            );
        this.createDisputeInvalidBlockInStateProofApplyFraudProof(hash);
        return BlockValidationResult.DISPUTE;
    }
    public async conflictingButNotLinkedBlockDetected(
        _entry: QueuedBlockEntry
    ): Promise<BlockValidationResult> {
        return this.handleInvalidBlockStructure();
    }
    public async blockForkIsDisputed(
        _entry: QueuedBlockEntry
    ): Promise<BlockValidationResult> {
        throw new Error(
            "DisputeValidationStrategy - blockForkIsDisputed should not be called"
        );
    }
    public async blockIsNotNextAndIsInTheFuture(
        _entry: QueuedBlockEntry
    ): Promise<BlockValidationResult> {
        throw new Error(
            "DisputeValidationStrategy - blockIsNotNextAndIsInTheFuture should not be called"
        );
    }
    public async blockIsNotLinkedAndIsNotFirstBlock(
        _entry: QueuedBlockEntry
    ): Promise<BlockValidationResult> {
        return this.handleInvalidBlockStructure();
    }
    public async objectiveInvalidTimestampDetected(
        block: Block
    ): Promise<BlockValidationResult> {
        // TODO - think about this - can this change over time? i.e. can onChainTimestamp or the presence of calldata change things
        const hash = this.fraudProofService.createInvalidTimestampProof(block);
        this.createDisputeInvalidBlockInStateProofApplyFraudProof(hash);
        return BlockValidationResult.DISPUTE;
    }
    public async subjectiveInvalidTimestampDetected(
        _block: Block
    ): Promise<BlockValidationResult> {
        // This is not relevant here - just continue and accept the block
        return BlockValidationResult.SUCCESS;
    }
}
