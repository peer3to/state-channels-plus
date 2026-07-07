import { ZeroHash } from "ethers";

import ARpcMethods from "@/rpc/ARpcMethods";
import type P2PManager from "@/P2PManager";
import type ATransport from "@/transport/ATransport";
import { Codec, Type } from "@/utils";
import Block from "@/models/Block";
import type { Address, ChannelId, ForkId } from "@/types/types";
import type { HarnessControlRpc } from "../../HarnessControlRpc";
import type { SpectateControlService } from "./SpectateControlService";

/**
 * Spectator-flow endpoints, executed host-side. `SyncPayload` carries model
 * instances, so it crosses the port encoded (`Type.SyncPayload`) — the harness
 * decodes/inspects it on the main thread. Helpers/accessors are on
 * {@link SpectateControlService}.
 */
export class SpectateControlRpcMethods extends ARpcMethods<
    P2PManager<HarnessControlRpc>
> {
    constructor(
        transport: ATransport,
        private readonly service: SpectateControlService
    ) {
        super(transport, service.p2pManager);
    }

    /** Generate a sync payload, returned encoded (or null). */
    public async generateSyncPayload(
        channelId: ChannelId,
        forkId: ForkId,
        blockHeight: number
    ): Promise<{ encodedSyncPayload: string } | null> {
        const payload = await this.service.spectate.generateSyncPayload(
            channelId,
            forkId,
            blockHeight
        );
        // `Codec.encode` returns an ABI hex string (serializable across the port).
        return payload
            ? {
                  encodedSyncPayload: Codec.encode(
                      payload,
                      Type.SyncPayload
                  ) as string
              }
            : null;
    }

    /**
     * Start a real local spectate sync toward `peerAddress`, targeting the
     * host peer's own channel. Fire-and-forget (as `SpectateService.sync`
     * is): returns once the request is launched — tests wait on observable
     * convergence / blacklist state, not this return.
     */
    public startSync(
        peerAddress: Address,
        forkId?: ForkId,
        blockHeight?: number
    ): boolean {
        const channelId = this.service.sm.channelId;
        if (channelId === ZeroHash) {
            throw new Error(
                "startSync - host peer has no channel; cannot start sync"
            );
        }
        this.service.spectate.sync(peerAddress, channelId, forkId, blockHeight);
        return true;
    }

    /** Persist an encoded sync payload; returns whether spectating aborted. */
    public async persistSyncPayload(
        encodedSyncPayload: string
    ): Promise<{ shouldAbort: boolean }> {
        const payload = Codec.decode(encodedSyncPayload, Type.SyncPayload);
        return this.service.spectate.persistSyncPayload(payload);
    }

    /** Store a block straight into storage (`justPersist`); returns its hash. */
    public storeBlockJustPersist(encodedSignedBlock: string): string {
        const block = Block.fromSignedBlock(
            Codec.decode(encodedSignedBlock, Type.SignedBlock)
        );
        return String(
            this.service.sm.storage.blocks.storeBlock(block, {
                justPersist: true
            })
        );
    }
}

export default SpectateControlRpcMethods;
