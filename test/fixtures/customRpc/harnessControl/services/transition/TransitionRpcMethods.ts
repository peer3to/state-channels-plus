import ARpcMethods from "@/rpc/ARpcMethods";
import type ATransport from "@/transport/ATransport";
import type { ForkId } from "@/types/types";
import type { IngestBlockConfirmationOptions } from "@/stateManager/BlockQueueManager";
import { Block } from "@/models";
import { Codec, Type } from "@/utils";
import type { TransitionService } from "./TransitionService";

/**
 * Serializable projection of `prepareUpdateSnapshotSameFork`. Snapshots carry
 * bigints, so they cross the port `Codec.encode`d as `Type.StateSnapshot`.
 */
export interface SameForkSnapshotUpdate {
    callData: string[];
    encodedExpectedSnapshot: string;
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
            await this.service.sm.postStateSnapshot(forkId)
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
    ): Promise<SameForkSnapshotUpdate | null> {
        const data =
            await this.service.sm.prepareUpdateSnapshotSameFork(forkId);
        if (!data) return null;
        return {
            callData: data.callData,
            encodedExpectedSnapshot: Codec.encode(
                data.expectedSnapshot.toStruct(),
                Type.StateSnapshot
            ) as string,
            encodedMilestoneSnapshots: data.milestoneSnapshots.map(
                (s) => Codec.encode(s.toStruct(), Type.StateSnapshot) as string
            )
        };
    }

    public async ingestBlockConfirmation(
        encodedBlockConfirmation: string,
        options?: IngestBlockConfirmationOptions
    ): Promise<boolean> {
        return await this.service.sm.ingestBlockConfirmation(
            Codec.decode(encodedBlockConfirmation, Type.BlockConfirmation),
            options
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
