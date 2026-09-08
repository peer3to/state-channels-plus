// @spec-test-coverage-ignore: public validation probe endpoints
import type {
    BlockCalldataRecoveryProbe,
    BlockIngestProbe,
    BlockProbeOptions,
    BlockValidationProbe,
    BlockValidationProbeOptions,
    CleanCommittedDivergenceProbe,
    ConcurrentCalldataRecoveryProbe,
    DisputeStrategyResultMatrix,
    InboundRunRecoveryProbe,
    IsDisputedForkProbe,
    MissingParticipantSnapshotsProbe,
    ReductionChallengeProbe,
    ValidationProbeService
} from "./ValidationProbeService";
import type { HarnessControlRpc } from "../../HarnessControlRpc";
import type P2PManager from "@/P2PManager";
import ARpcMethods from "@/rpc/ARpcMethods";
import type ATransport from "@/transport/ATransport";
import type { Address, ForkId, Hash, Timestamp } from "@/types/types";
export class ValidationProbeRpcMethods extends ARpcMethods<
    P2PManager<HarnessControlRpc>
> {
    constructor(
        transport: ATransport,
        private readonly service: ValidationProbeService
    ) {
        super(transport, service.p2pManager);
    }

    public async probeDisputeReductionChallenge(
        reducedForkId: ForkId
    ): Promise<ReductionChallengeProbe> {
        return this.service.probeDisputeReductionChallenge(reducedForkId);
    }

    public async probeInboundRunRecovery(
        upperBlockHash: Hash,
        options?: { failChainQueries?: boolean }
    ): Promise<InboundRunRecoveryProbe> {
        return this.service.probeInboundRunRecovery(upperBlockHash, options);
    }

    public async probeBlockCalldataRecovery(options?: {
        failChainQueries?: boolean;
    }): Promise<BlockCalldataRecoveryProbe> {
        return this.service.probeBlockCalldataRecovery(options);
    }

    public async probeConcurrentCalldataRecovery(): Promise<ConcurrentCalldataRecoveryProbe> {
        return this.service.probeConcurrentCalldataRecovery();
    }

    public async probeDisputeStrategyResultMatrix(): Promise<DisputeStrategyResultMatrix> {
        return this.service.probeDisputeStrategyResultMatrix();
    }

    public async probeCleanCommittedDivergence(): Promise<CleanCommittedDivergenceProbe> {
        return this.service.probeCleanCommittedDivergence();
    }

    public async probeMissingParticipantSnapshots(): Promise<MissingParticipantSnapshotsProbe> {
        return this.service.probeMissingParticipantSnapshots();
    }

    public async probeAuthorGatePreviousSnapshotMember(): Promise<string> {
        return this.service.probeAuthorGatePreviousSnapshotMember();
    }

    public async probeAuthorGateMatchingResultingSnapshot(): Promise<string> {
        return this.service.probeAuthorGateMatchingResultingSnapshot();
    }

    public async probeAuthorGateStaleHeightSnapshot(): Promise<string> {
        return this.service.probeAuthorGateStaleHeightSnapshot();
    }

    public async probeAuthorGateWrongForkSnapshot(): Promise<string> {
        return this.service.probeAuthorGateWrongForkSnapshot();
    }

    public async probeAuthorGateMatchingSnapshotExcludingAuthor(): Promise<string> {
        return this.service.probeAuthorGateMatchingSnapshotExcludingAuthor();
    }

    public async probeAuthorGateMissingSnapshotPreviousMember(): Promise<string> {
        return this.service.probeAuthorGateMissingSnapshotPreviousMember();
    }

    public async probeAuthorGateMissingSnapshotOutsider(): Promise<string> {
        return this.service.probeAuthorGateMissingSnapshotOutsider();
    }

    public async probeAuthorGateNoAnchorCurrentParticipant(): Promise<string> {
        return this.service.probeAuthorGateNoAnchorCurrentParticipant();
    }

    public async probeAuthorGateNoAnchorPendingParticipant(
        pendingParticipant: string
    ): Promise<string> {
        return this.service.probeAuthorGateNoAnchorPendingParticipant(
            pendingParticipant as Address
        );
    }

    public async probeAuthorGateNoAnchorUnknownAddress(): Promise<string> {
        return this.service.probeAuthorGateNoAnchorUnknownAddress();
    }

    /** Run isDisputedFork, counting local-diamond queries. */
    public async probeIsDisputedFork(
        forkId: ForkId,
        markLocallyDisputed: boolean
    ): Promise<IsDisputedForkProbe> {
        return this.service.probeIsDisputedFork(forkId, markLocallyDisputed);
    }

    /** Store a block directly into block storage (dispute-replay fixtures). */
    public storeBlockFixture(encodedBlockConfirmation: string): {
        hash: string;
    } {
        return this.service.storeBlockFixture(encodedBlockConfirmation);
    }

    /** Store a state snapshot directly into snapshot storage. */
    public storeStateSnapshotFixture(encodedSnapshot: string): {
        hash: string;
    } {
        return this.service.storeStateSnapshotFixture(encodedSnapshot);
    }

    /** Stage on-chain calldata for a block at a chosen timestamp. */
    public stageBlockCalldata(
        encodedSignedBlock: string,
        onChainTimestamp: Timestamp
    ): boolean {
        this.service.stageBlockCalldata(encodedSignedBlock, onChainTimestamp);
        return true;
    }

    /** Post a block's calldata on-chain (chain-fallback path). */
    public async postBlockCalldataOnChain(
        encodedSignedBlock: string
    ): Promise<{ blockNumber: number; onChainTimestamp: Timestamp }> {
        return this.service.postBlockCalldataOnChain(encodedSignedBlock);
    }

    public async runBlockValidation(
        encodedBlockConfirmation: string,
        options?: BlockValidationProbeOptions
    ): Promise<BlockValidationProbe> {
        return this.service.runBlockValidation(
            encodedBlockConfirmation,
            options
        );
    }

    public async runBlockIngest(
        encodedBlockConfirmation: string,
        options?: BlockProbeOptions
    ): Promise<BlockIngestProbe> {
        return this.service.runBlockIngest(encodedBlockConfirmation, options);
    }

    public async runStoredBlockMerge(
        encodedBlockConfirmation: string,
        options?: {
            strategy?: "active" | "dispute" | "spectating" | "calldata";
        }
    ): Promise<{
        result: number | null;
        persistedSignatures: string[] | null;
    }> {
        return this.service.runStoredBlockMerge(
            encodedBlockConfirmation,
            options
        );
    }
}
export default ValidationProbeRpcMethods;
