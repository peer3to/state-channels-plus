import ARpcService from "@/rpc/ARpcService";
import type P2PManager from "@/P2PManager";
import type ATransport from "@/transport/ATransport";
import { Codec, Type } from "@/utils";
import type { SyncPayload } from "@/types/spectate";
import type { Address } from "@/types/types";
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

    /** Whether a sync is currently held in-flight for this peer (guard state). */
    isSyncInFlight(peerAddress: Address): boolean {
        return this.spectate.isSyncInFlight(peerAddress);
    }

    public createRPCMethods(transport: ATransport): SpectateControlRpcMethods {
        return new SpectateControlRpcMethods(transport, this);
    }
}

export default SpectateControlService;
