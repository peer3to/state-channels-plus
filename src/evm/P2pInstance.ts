import type ClientChainSigner from "./signer/ClientChainSigner";
import type ClientP2pSigner from "./signer/ClientP2pSigner";
import type { EventBus } from "@/events/EventBus";
import type { P2pRuntimeClientRoot } from "@/rpc/internal/roots/P2pRuntimeClientRoot";
import MainRpcService from "@/rpc/network/MainRpcService";
import type { RemoteRpcProxyType } from "@/rpc/network/RemoteRpcProxy";
import type StateManager from "@/stateManager/StateManager";
import { Logger } from "@/utils";
import type { StateChannelManagerInterface } from "@typechain-types";
import { AStateMachine } from "@typechain-types";

export default class P2pInstance<
    T extends AStateMachine,
    TCustomRpc extends MainRpcService = MainRpcService
> {
    p2pContractInstance: T;
    p2pSigner: ClientP2pSigner;
    chainSigner: ClientChainSigner;
    stateChannelManagerContract: StateChannelManagerInterface;
    logger: Logger;

    /**
     * Typed mirror of the host's `remoteRpc`. Calls are forwarded over the
     * runtime port and applied by the host: with no target the method runs on
     * the host itself (loopback); with a peer address it is relayed to that
     * peer (and, for request/response methods, the reply is returned across the
     * port).
     */
    hostRpc: RemoteRpcProxyType<TCustomRpc>;

    /**
     * Client event surface: `events.on(kind, eventName, listener)` for
     * p2p hooks, contract events, and mirrored `EventHandler` events — the
     * same bus shape the worker realm exposes on `stateManager.events`.
     */
    readonly events: EventBus;

    private readonly p2pRuntimeClientRoot: P2pRuntimeClientRoot;
    private disposal?: Promise<void>;
    private leavePromise?: Promise<void>;

    /**
     * Main-thread end of the WebRTC bridge `MessagePort`. Present only when the
     * host runs in a worker that can't drive `RTCPeerConnection` itself; forward
     * it up any worker nesting (in each `postMessage` transfer list) to the real
     * main thread and pass it to `installWebRTCMainThreadBridge(port)`.
     */
    get webRTCBridgePort(): MessagePort | undefined {
        return this.p2pRuntimeClientRoot.webRTCBridgePort;
    }

    /**
     * When running on the real main thread, wire the host's WebRTC bridge port
     * to the local `RTCPeerConnection` automatically — there is no further
     * worker nesting to bubble it up to. Inside a worker this is a no-op: the
     * port stays on {@link webRTCBridgePort} for the consumer app to bubble up
     * and install on the main thread. A no-op when no bridge port was surfaced.
     */
    public installMainThreadBridgeIfOnMainThread(): void {
        this.p2pRuntimeClientRoot.installMainThreadBridgeIfOnMainThread();
    }

    constructor(
        client: P2pRuntimeClientRoot,
        application: {
            contract: T;
            signer: ClientP2pSigner;
            chainSigner: ClientChainSigner;
            stateChannelManagerContract: StateChannelManagerInterface;
            logger: Logger;
            hostRpc: RemoteRpcProxyType<TCustomRpc>;
        }
    ) {
        this.p2pRuntimeClientRoot = client;
        this.p2pContractInstance = application.contract;
        this.p2pSigner = application.signer;
        this.chainSigner = application.chainSigner;
        this.stateChannelManagerContract =
            application.stateChannelManagerContract;
        this.logger = application.logger;
        this.events = client.events;
        this.hostRpc = application.hostRpc;
        client.onClosed(() => {
            if (!this.disposal) void this.dispose();
        });
    }

    public dispose(): Promise<void> {
        return (this.disposal ??= this.disposeApplication());
    }

    private async disposeApplication(): Promise<void> {
        // every teardown runs to the end before the logger goes: a listener
        // removal that rejects must not take the realm off the bus while the
        // client is still closing and may still log
        const outcomes = await Promise.allSettled([
            this.p2pContractInstance.removeAllListeners(),
            this.stateChannelManagerContract.removeAllListeners(),
            this.p2pRuntimeClientRoot.dispose()
        ]);
        // leaves the realm bus with the session: otherwise every closed
        // session keeps its store and its process crash hooks, and every
        // later round re-uploads it
        this.logger.dispose({ cascadeChildren: true });
        for (const outcome of outcomes) {
            if (outcome.status === "rejected") throw outcome.reason;
        }
    }

    /**
     * Leave the current channel and keep the runtime. The promise settles once
     * departure is observed and the runtime has been reset to its pre-channel
     * state, so the same instance can then select another channel. Shutdown is
     * a separate, explicit `dispose()`.
     */
    public leaveChannel(): Promise<void> {
        // Shared while pending so repeated calls make one host request; the
        // host's own memo decides what a call after a failure sees.
        this.leavePromise ??= this.p2pSigner.leaveChannel().finally(() => {
            this.leavePromise = undefined;
        });
        return this.leavePromise;
    }

    /**
     * Observe autonomous host-side errors (e.g. a worker-thread
     * unhandledRejection) in the client runtime. With no subscriber the error is
     * re-thrown as a client-runtime unhandled rejection. Returns an unsubscribe fn.
     */
    public onHostError(listener: (error: Error) => void): () => void {
        return this.p2pRuntimeClientRoot.onHostError(listener);
    }

    /**
     * Drain this peer's host-side detached async work over the port and return
     * any rejections. Lets an orchestrator settle host work uniformly whether
     * the host is inline, in a worker, or remote.
     */
    public quiesce(): Promise<Error[]> {
        return this.p2pRuntimeClientRoot.quiesce();
    }

    /**
     * Direct state manager access is intentionally disabled for all modes.
     * Runtime interaction must happen through message-port RPC boundaries.
     */
    public getStateManager(): StateManager<TCustomRpc> {
        throw new Error(
            "getStateManager() is disabled; use runtime RPC over the message port"
        );
    }
}
