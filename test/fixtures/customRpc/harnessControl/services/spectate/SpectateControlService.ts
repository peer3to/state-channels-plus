import ARpcService from "@/rpc/ARpcService";
import Clock from "@/Clock";
import type P2PManager from "@/P2PManager";
import type { SyncRequest } from "@/rpc/services/spectate/SpectateService";
import type ATransport from "@/transport/ATransport";
import type { ForkId } from "@/types/types";
import { Codec, Type } from "@/utils";
import type { SyncPayload } from "@/types/spectate";
import type { HarnessControlRpc } from "../../HarnessControlRpc";
import SpectateControlRpcMethods from "./SpectateControlRpcMethods";

/**
 * Spectator-flow operations for white-box tests, executed host-side. The live
 * `spectateService` and storage are behind the runtime port; this exposes the
 * pieces tests drive directly (generate/persist sync payload, just-persist a
 * block). Accessors/state live here, not on the routable RpcMethods class.
 *
 * Typing `p2pManager` as `P2PManager<HarnessControlRpc>` gives fully-typed
 * access to `localRpc` (the SDK's own services included) with no casts.
 */
export class SpectateControlService extends ARpcService<
    SpectateControlRpcMethods,
    P2PManager<HarnessControlRpc>
> {
    constructor(p2pManager: P2PManager<HarnessControlRpc>) {
        super(
            p2pManager,
            p2pManager.stateManager.logger.child({
                component: "HarnessSpectateService"
            })
        );
    }

    get sm() {
        return this.p2pManager.stateManager;
    }

    /** Decode an encoded sync payload host-side (for `execOnHost` bodies). */
    decodeSyncPayload(encoded: string): SyncPayload {
        return Codec.decode(encoded, Type.SyncPayload);
    }

    /** The SDK's live spectate service on this peer's local RPC. */
    get spectate() {
        return this.p2pManager.localRpc.spectateService;
    }

    /** A targeted sync request for this peer's own channel, stamped now. */
    buildSyncRequest(forkId: ForkId, blockHeight: number): SyncRequest {
        return {
            channelId: this.sm.channelId,
            initTime: Clock.getTimeInSeconds(),
            forkId,
            blockHeight
        };
    }

    public createRPCMethods(transport: ATransport): SpectateControlRpcMethods {
        return new SpectateControlRpcMethods(transport, this);
    }
}

export default SpectateControlService;
