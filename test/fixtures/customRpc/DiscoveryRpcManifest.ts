import ARpcMethods from "@/rpc/ARpcMethods";
import ARpcService from "@/rpc/ARpcService";
import type ATransport from "@/transport/ATransport";
import type P2PManager from "@/P2PManager";
import { getChecksumAddress } from "@/utils";
import type { AdmissionPolicy } from "@/discovery/AdmissionPolicy";
import OpenChannelNegotiationService from "@/rpc/services/openChannelNegotiation/OpenChannelNegotiationService";
import { type OpenChannelNegotiationP2PManager } from "@/rpc/services/openChannelNegotiation/OpenChannelNegotiationRpcMethods";
import LobbyService from "@/rpc/services/lobby/LobbyService";
import { type LobbyP2PManager } from "@/rpc/services/lobby/LobbyRpcMethods";
import { HarnessControlRpc } from "./harnessControl/HarnessControlRpc";

/**
 * Custom RPC manifest for this e2e suite: OpenChannelNegotiationService and
 * LobbyService are both opt-in (not in MainRpcService) and have no e2e
 * coverage anywhere else, so the discovery e2e suites
 * need a manifest that wires them up, the same way PingPongRpcManifest
 * showcases a bespoke custom RPC. `ChannelAcquisitionCoordinator`'s and
 * `LocalP2pSigner`'s capability checks
 * (`p2pManager.localRpc.openChannelNegotiationService instanceof
 * OpenChannelNegotiationService` / `...lobbyService instanceof
 * LobbyService`) are what make these field names load-bearing — they must
 * be exactly `openChannelNegotiationService` / `lobbyService`.
 */
export class DiscoveryRpc extends HarnessControlRpc {
    openChannelNegotiationService: OpenChannelNegotiationService;
    negotiationTest: NegotiationTestService;
    lobbyService: LobbyService;

    constructor(p2pManager: P2PManager<DiscoveryRpc>) {
        super(p2pManager as unknown as P2PManager<HarnessControlRpc>);
        this.openChannelNegotiationService = new OpenChannelNegotiationService(
            p2pManager as unknown as OpenChannelNegotiationP2PManager
        );
        this.negotiationTest = new NegotiationTestService(
            p2pManager as unknown as P2PManager,
            this.openChannelNegotiationService
        );
        this.lobbyService = new LobbyService(
            p2pManager as unknown as LobbyP2PManager
        );
    }
}

/**
 * Test-only harness surface: deterministically arms this
 * peer's `OpenChannelNegotiationService.state` so a mismatched-proposal
 * scenario can be driven WITHOUT racing the real SDK's own auto-proposal
 * (`maybeProgress` fires automatically, from the LOWER address, the instant
 * a real negotiateAccept lands - there is no legitimate wire sequence that
 * reaches "negotiating, amount known" on the HIGHER address without also
 * triggering the lower peer's own correct auto-proposal in the same tick).
 * `state` is a PUBLIC field of the *Service* (never routable itself - this
 * is a companion *RpcMethods endpoint, mirroring the harnessControl
 * `stub`/`byzantine` services' "craft a wire message, run the real receiver
 * path" idiom). Test-only; never used by production code.
 */
export class NegotiationTestService extends ARpcService<NegotiationTestRpcMethods> {
    constructor(
        p2pManager: P2PManager,
        public readonly negotiationService: OpenChannelNegotiationService
    ) {
        super(
            p2pManager,
            p2pManager.stateManager.logger.child({
                component: "NegotiationTestService"
            })
        );
    }

    public createRPCMethods(transport: ATransport): NegotiationTestRpcMethods {
        return new NegotiationTestRpcMethods(transport, this);
    }
}

class NegotiationTestRpcMethods extends ARpcMethods {
    constructor(
        transport: ATransport,
        private readonly service: NegotiationTestService
    ) {
        super(transport, service.p2pManager);
    }

    /**
     * Directly arms `state.negotiatingWith` / `state.theirAmount`, bypassing
     * the wire negotiateRequest/Accept exchange (and its auto-proposal side
     * effect) entirely. Returns a non-void ack (rather than `void`/
     * `Promise<void>`) so this crosses `RemoteRpcProxyType` as request/
     * response-capable (`.request()`), not fire-and-forget - see
     * RpcHandleProxy.ts's `RpcCallHandler`.
     */
    public async armNegotiationState(
        peerAddress: string,
        theirAmount: number
    ): Promise<{ armed: true }> {
        const state = this.service.negotiationService.state;
        state.negotiatingWith = getChecksumAddress(peerAddress);
        state.initiatedByMe = false;
        state.theirAmount = theirAmount;
        state.startedAtMs = Date.now();
        return { armed: true };
    }

    /**
     * Sets the NEGOTIATE-layer admission policy on this
     * peer's `OpenChannelNegotiationService`. `OpenChannelNegotiationService
     * .setAdmissionPolicy` is deliberately a *Service* method, never exposed
     * on the production `OpenChannelNegotiationRpcMethods` ("never
     * settable from OpenChannelNegotiationRpcMethods") - this test-only
     * endpoint is the harness's own loopback path to it, distinct from the
     * discovery facade's `setAdmissionPolicy` (which only reaches the LOBBY's
     * admission policy).
     */
    public async setNegotiationAdmissionPolicy(
        policy: AdmissionPolicy
    ): Promise<{ ok: true }> {
        this.service.negotiationService.setAdmissionPolicy(policy);
        return { ok: true };
    }
}

export default DiscoveryRpc;
