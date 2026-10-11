// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import QueryRpcMethods, {
    type BlockBundle,
    type StateProofVerification
} from "./QueryRpcMethods";
import type { GasUsageRow } from "@/evm/gasUsage/GasUsageTable";
import Block from "@/models/Block";
import StateSnapshot from "@/models/StateSnapshot";
import type P2PManager from "@/P2PManager";
import ANetworkRpcService from "@/rpc/network/ANetworkRpcService";
import type NetworkTransport from "@/transport/NetworkTransport";
import type { BlockHeight, ForkId } from "@/types/types";
import { Codec, Type } from "@/utils";
import { config } from "@/utils/config";

/**
 * Read-only peer-state queries exposed to the test harness. Accessors live here
 * (not on the RpcMethods class) since every RpcMethods method is routable by
 * name at runtime.
 */
export class QueryService extends ANetworkRpcService<QueryRpcMethods> {
    constructor(p2pManager: P2PManager) {
        super(
            p2pManager.rpcRouter,
            p2pManager.stateManager.logger.child({
                component: "HarnessQueryService"
            })
        );
    }

    get sm() {
        return this.p2pManager.stateManager;
    }
    get storage() {
        return this.sm.storage;
    }

    /** Project a live `Block` into a serializable bundle for the harness. */
    toBlockBundle(block: Block): BlockBundle {
        return {
            hash: String(block.hash),
            author: String(block.author),
            height: Number(block.height),
            stateSnapshotHash: String(block.stateSnapshotHash),
            encodedSignedBlock: Codec.encode(
                block.signedBlock,
                Type.SignedBlock
            ) as string,
            encodedBlockConfirmation: Codec.encode(
                block.blockConfirmationStruct,
                Type.BlockConfirmation
            ) as string,
            timestamp: Number(block.timestamp),
            onChainTimestamp:
                block.onChainTimestamp === undefined
                    ? null
                    : Number(block.onChainTimestamp),
            confirmationSignatures: [...block.confirmationSignatures].map(
                String
            ),
            confirmationSignerAddresses: [
                ...block.confirmationSignerAddresses
            ].map(String)
        };
    }

    getParticipantChangeHeights(forkId: ForkId): BlockHeight[] {
        return this.storage.participantSetChanges
            .getChangePointsInRange(forkId)
            .map(Number);
    }

    async buildStateProofVerification(
        forkId: ForkId,
        blockHeight?: BlockHeight
    ): Promise<StateProofVerification | null> {
        const sm = this.sm;
        const agreementManager = sm.agreementManager;
        const genesis =
            this.storage.stateSnapshots.getGenesisSnapshotByForkId(forkId);
        if (!genesis) return null;

        const height =
            blockHeight ??
            Math.max(0, this.storage.blocks.getNextBlockHeight(forkId) - 1);
        const built = await agreementManager.buildStateProof(forkId, height);
        const proof = built.stateProof;

        const chainWalk = await agreementManager.walkFromChainAnchor(
            forkId,
            proof,
            built.evidence
        );
        let isFinal: boolean | null = null;
        let onChainFinalizedSnapshotHash: string | null = null;
        if (proof.milestones.length > 0) {
            const { isFinal: milestoneIsFinal, finalizedSnapshotHash } =
                await sm.stateChannelManagerContract.isMilestoneFinal.staticCall(
                    forkId,
                    built.startSnapshot.snapshotData,
                    proof.milestones[0]
                );
            isFinal = milestoneIsFinal;
            onChainFinalizedSnapshotHash = String(finalizedSnapshotHash);
        }

        const latestBlock =
            agreementManager.getLatestBlockFromStateProof(proof);
        return {
            blockHeight: Number(height),
            milestoneCount: proof.milestones.length,
            latestProofHeight: latestBlock ? Number(latestBlock.height) : null,
            milestoneConfirmationHeights: proof.milestones.map((milestone) =>
                milestone.blockConfirmations.map((confirmation) =>
                    Number(Block.fromBlockConfirmation(confirmation).height)
                )
            ),
            milestoneSnapshotHashes: built.evidence.milestoneSnapshots.map(
                (snapshot) => String(StateSnapshot.from(snapshot).hash)
            ),
            verified: chainWalk.valid,
            chainReplayBlockIndex: chainWalk.replayBlockIndex,
            isFinal,
            onChainFinalizedSnapshotHash,
            latestSnapshotHash: String(
                agreementManager.getLatestSnapshotFromStateProof(proof, forkId)
                    .hash
            ),
            finalizedSnapshotHash: String(built.finalizedSnapshot.hash),
            startSnapshotHash: String(built.startSnapshot.hash),
            genesisSnapshotHash: String(genesis.hash)
        };
    }

    /**
     * The peer's gas usage table, settled by its one owner in `src` under the
     * same bound as the public read.
     */
    async settledGasUsage(): Promise<{ gasUsage: GasUsageRow[] }> {
        return {
            gasUsage: await this.sm.signer.gasUsage.settledSnapshot(
                config.GAS_USAGE_SETTLE_MS
            )
        };
    }

    public createRPCMethods(transport: NetworkTransport): QueryRpcMethods {
        return new QueryRpcMethods(transport, this);
    }
}

export default QueryService;
