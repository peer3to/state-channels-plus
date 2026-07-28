import ARpcService from "@/rpc/ARpcService";
import type P2PManager from "@/P2PManager";
import type ATransport from "@/transport/ATransport";
import Block from "@/models/Block";
import { Codec, Type } from "@/utils";
import type { BlockHeight, ForkId } from "@/types/types";
import QueryRpcMethods, {
    type BlockBundle,
    type StateProofVerification
} from "./QueryRpcMethods";

/**
 * Read-only peer-state queries exposed to the test harness. Accessors live here
 * (not on the RpcMethods class) since every RpcMethods method is routable by
 * name at runtime.
 */
export class QueryService extends ARpcService<QueryRpcMethods> {
    constructor(p2pManager: P2PManager) {
        super(
            p2pManager,
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
        const genesis =
            this.storage.stateSnapshots.getGenesisSnapshotByForkId(forkId);
        if (!genesis) return null;

        const height =
            blockHeight ??
            Math.max(0, this.storage.blocks.getNextBlockHeight(forkId) - 1);
        const proof = await sm.agreementManager.tryGetStateProof(
            forkId,
            height
        );
        if (!proof) return null;

        let verified = false;
        let isFinal: boolean | null = null;
        let onChainFinalizedSnapshotHash: string | null = null;
        if (proof.milestones.length > 0) {
            const milestoneSnapshots = proof.milestones.map((m) =>
                sm.agreementManager.getSnapshotFromMilestone(m)!.toStruct()
            );
            verified =
                await sm.stateChannelManagerContract.verifyMilestones.staticCall(
                    forkId,
                    proof.milestones,
                    milestoneSnapshots,
                    genesis.toStruct()
                );

            const { isFinal: milestoneIsFinal, finalizedSnapshotHash } =
                await sm.stateChannelManagerContract.isMilestoneFinal.staticCall(
                    forkId,
                    genesis.snapshotData,
                    proof.milestones[0]
                );
            isFinal = milestoneIsFinal;
            onChainFinalizedSnapshotHash = String(finalizedSnapshotHash);
        } else if (proof.signedBlocks.length > 0) {
            verified =
                await sm.stateChannelManagerContract.areSignedBlocksLinkedAndVerified.staticCall(
                    proof.signedBlocks
                );
        }

        const milestoneConfirmationHeights = proof.milestones.map((milestone) =>
            milestone.blockConfirmations.map((c) =>
                Number(Block.fromBlockConfirmation(c).height)
            )
        );

        const milestoneSnapshotHashes = proof.milestones.map((m) =>
            String(sm.agreementManager.getSnapshotFromMilestone(m)!.hash)
        );

        const latestBlock =
            sm.agreementManager.getLatestBlockFromStateProof(proof);
        return {
            blockHeight: Number(height),
            milestoneCount: proof.milestones.length,
            signedBlockCount: proof.signedBlocks.length,
            latestProofHeight: latestBlock ? Number(latestBlock.height) : null,
            milestoneConfirmationHeights,
            milestoneSnapshotHashes,
            verified,
            isFinal,
            onChainFinalizedSnapshotHash,
            latestSnapshotHash: String(
                sm.agreementManager.getLatestSnapshotFromStateProof(
                    proof,
                    forkId
                ).hash
            ),
            finalizedSnapshotHash: String(
                sm.agreementManager.getLatestFinalizedSnapshot(proof, forkId)
                    .hash
            ),
            genesisSnapshotHash: String(genesis.hash)
        };
    }

    public createRPCMethods(transport: ATransport): QueryRpcMethods {
        return new QueryRpcMethods(transport, this);
    }
}

export default QueryService;
