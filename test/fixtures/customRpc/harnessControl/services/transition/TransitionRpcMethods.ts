// @spec-test-coverage-ignore: transition fixture support exercised by owning mapped tests
import ARpcMethods from "@/rpc/ARpcMethods";
import type ATransport from "@/transport/ATransport";
import type { ForkId } from "@/types/types";
import type { IngestBlockConfirmationOptions } from "@/stateManager/ingest/BlockQueueManager";
import { Block } from "@/models";
import { Codec, Type } from "@/utils";
import type { TransitionService } from "./TransitionService";

/**
 * Serializable projection of `prepareUpdateSnapshotSameFork`. Snapshots carry
 * bigints, so they cross the port `Codec.encode`d as `Type.StateSnapshot`.
 */
export interface SameForkSnapshotUpdate {
    canPost: boolean;
    callData: string[];
    encodedExpectedSnapshot?: string;
    encodedMilestoneSnapshots: string[];
}

/**
 * State-transition operations executed host-side. Only public endpoints live
 * here; accessors are on {@link TransitionService}. Snapshot structs carry
 * bigints, so they cross the port as `Codec.encode(_, Type.StateSnapshot)`.
 */
export class TransitionRpcMethods extends ARpcMethods {
    constructor(
        transport: ATransport,
        private readonly service: TransitionService
    ) {
        super(transport, service.p2pManager);
    }

    /** Post a fresh state snapshot for `forkId`; returns the encoded snapshot or null. */
    public async postStateSnapshot(
        forkId: ForkId
    ): Promise<{ encodedSnapshot: string } | null> {
        const struct = (
            await this.service.sm.snapshotUpdateService.postStateSnapshot(
                forkId
            )
        )?.toStruct();
        return struct
            ? {
                  encodedSnapshot: Codec.encode(
                      struct,
                      Type.StateSnapshot
                  ) as string
              }
            : null;
    }

    /** Post a fresh snapshot and propagate its exact transaction failure. */
    public async postStateSnapshotWait(
        forkId: ForkId
    ): Promise<{ encodedSnapshot: string } | null> {
        const struct = (
            await this.service.sm.snapshotUpdateService.postStateSnapshotWait(
                forkId
            )
        )?.toStruct();
        return struct
            ? {
                  encodedSnapshot: Codec.encode(
                      struct,
                      Type.StateSnapshot
                  ) as string
              }
            : null;
    }

    /** Same-fork snapshot-update data (calldata + encoded snapshots). */
    public async prepareUpdateSnapshotSameFork(
        forkId: ForkId
    ): Promise<SameForkSnapshotUpdate> {
        const data =
            await this.service.sm.snapshotUpdateService[
                "prepareUpdateSnapshotSameFork"
            ](forkId);
        return {
            canPost: data.canPost,
            callData: data.callData,
            encodedExpectedSnapshot: data.expectedSnapshot
                ? (Codec.encode(
                      data.expectedSnapshot.toStruct(),
                      Type.StateSnapshot
                  ) as string)
                : undefined,
            encodedMilestoneSnapshots: data.milestoneSnapshots.map(
                (s) => Codec.encode(s.toStruct(), Type.StateSnapshot) as string
            )
        };
    }

    public async ingestBlockConfirmation(
        encodedBlockConfirmation: string,
        options?: IngestBlockConfirmationOptions
    ): Promise<boolean> {
        const queue = this.service.sm.blockQueueManager;
        return await this.service.stub.controlIngestContext.run(true, () =>
            queue.ingestBlockConfirmation(
                Codec.decode(encodedBlockConfirmation, Type.BlockConfirmation),
                options
            )
        );
    }

    /**
     * Persist a block straight into storage — bypassing the confirmation
     * pipeline — the way spectate/state-proof persistence does.
     */
    public async storeBlock(
        encodedBlockConfirmation: string
    ): Promise<boolean> {
        this.service.sm.storage.blocks.storeBlock(
            Block.fromBlockConfirmation(
                Codec.decode(encodedBlockConfirmation, Type.BlockConfirmation)
            )
        );
        return true;
    }
}

export default TransitionRpcMethods;
