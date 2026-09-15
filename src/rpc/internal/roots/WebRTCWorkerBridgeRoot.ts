import { AInternalRpcRoot } from "../AInternalRpcRoot";
import { createRoot, type RootStartContext } from "../createRoot";
import type { RemoteRoot } from "../RemoteRoot";
import { WebRTCMainThreadBridgeRoot } from "./WebRTCMainThreadBridge";
import { WebRTCBridgeService } from "../services/webRTCBridge/WebRTCBridgeService";
import { WebRTCNegotiationService } from "../services/webRTCNegotiation/WebRTCNegotiationService";
import type WorkerBridgeWebRTCConnectionFactory from "@/rpc/network/services/WebRTCSetup/connection/WorkerBridgeWebRTCConnectionFactory";
import { adaptPort } from "@platform/p2pRuntimeChannel";

// Worker→main bridge requests are local postMessage round-trips that normally
// settle in milliseconds. This bound only exists so a dropped/closed bridge can
// never leave an awaiting WebRTC setup call hanging forever.
const BRIDGE_REQUEST_TIMEOUT_MS = 30_000;

export class WebRTCWorkerBridgeRoot extends AInternalRpcRoot {
    public webRTCBridge!: WebRTCBridgeService;
    public negotiation!: WebRTCNegotiationService;
    private webRTCMainThreadBridgeRemoteRoot!: Promise<
        RemoteRoot<WebRTCMainThreadBridgeRoot>
    >;

    constructor(
        _args: undefined,
        private readonly local:
            | {
                  port: MessagePort;
                  factory: WorkerBridgeWebRTCConnectionFactory;
              }
            | undefined,
        context: RootStartContext
    ) {
        if (!local)
            throw new Error(
                "Worker bridge requires its local connection factory and broker port"
            );
        super(
            (error) => {
                throw error;
            },
            BRIDGE_REQUEST_TIMEOUT_MS,
            context
        );
    }

    public async start(): Promise<void> {
        const local = this.local!;
        this.webRTCBridge = new WebRTCBridgeService(this.router, local.factory);
        this.webRTCMainThreadBridgeRemoteRoot = createRoot(
            WebRTCMainThreadBridgeRoot,
            {
                parent: this,
                mode: "attached",
                port: adaptPort(local.port),
                args: {}
            }
        );
        // Installing the main-thread broker is separate from runtime readiness.
        void this.webRTCMainThreadBridgeRemoteRoot.catch((error) => {
            if (!this.isDisposing) this.reportError(error);
        });
        this.negotiation = new WebRTCNegotiationService(this.router, {
            createOffer: async (peer) =>
                (await this.webRTCMainThreadBridgeRemoteRoot).rpc.negotiation
                    .createOffer(peer)
                    .request(),
            acceptOffer: async (peer, offer) =>
                (await this.webRTCMainThreadBridgeRemoteRoot).rpc.negotiation
                    .acceptOffer(peer, offer)
                    .request(),
            applyAnswer: async (peer, answer) =>
                (await this.webRTCMainThreadBridgeRemoteRoot).rpc.negotiation
                    .applyAnswer(peer, answer)
                    .request(),
            addIceCandidate: async (peer, candidate) =>
                (await this.webRTCMainThreadBridgeRemoteRoot).rpc.negotiation
                    .addIceCandidate(peer, candidate)
                    .request(),
            close: async (peer) =>
                (await this.webRTCMainThreadBridgeRemoteRoot).rpc.negotiation
                    .close(peer)
                    .request(),
            proxySend: async (peer, data) =>
                (await this.webRTCMainThreadBridgeRemoteRoot).rpc.negotiation
                    .proxySend(peer, data)
                    .request(),
            proxyClose: async (peer) =>
                (await this.webRTCMainThreadBridgeRemoteRoot).rpc.negotiation
                    .proxyClose(peer)
                    .request()
        });
    }

    // Implements root cleanup through the shared recursive disposal contract.
    public override dispose(): Promise<void> {
        // Fail pending bridge work during disposal instead of leaving callers waiting.
        return this.disposeRoot(() =>
            this.router.rejectAllRpcRequests(
                new Error("WebRTC bridge disposed with the runtime host")
            )
        );
    }
}

export type WebRTCWorkerBridgeRemoteRoot = RemoteRoot<WebRTCWorkerBridgeRoot>;
