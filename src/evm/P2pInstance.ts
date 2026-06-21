import { AStateMachine } from "@typechain-types";
import MainRpcService from "@/rpc/MainRpcService";
import type { RemoteRpcProxyType } from "@/rpc/RemoteRpcProxy";
import { Logger } from "@/utils";
import type StateManager from "@/stateManager/StateManager";
import type ClientP2pSigner from "./signer/ClientP2pSigner";
import type P2pRuntimeClient from "./p2pRuntime/P2pRuntimeClient";
import type {
    RuntimeEventMap,
    RuntimeEventName
} from "./p2pRuntime/RuntimeEventEmitter";
import { createHostRpc } from "./p2pRuntime/ClientHostRpc";

export default class P2pInstance<
    T extends AStateMachine,
    TCustomRpc extends MainRpcService = MainRpcService
> {
    p2pContractInstance: T;
    p2pSigner: ClientP2pSigner;
    logger: Logger;

    /**
     * Typed mirror of the host's `remoteRpc`. Calls are forwarded over the
     * runtime port and applied by the host: with no target the method runs on
     * the host itself (loopback); with a peer address it is relayed to that
     * peer (and, for request/response methods, the reply is returned across the
     * port).
     */
    hostRpc: RemoteRpcProxyType<TCustomRpc>;

    private readonly client: P2pRuntimeClient<T>;

    constructor(client: P2pRuntimeClient<T>, logger: Logger) {
        this.client = client;
        this.p2pContractInstance = client.contract;
        this.p2pSigner = client.signer;
        this.logger = logger;
        this.hostRpc = createHostRpc<TCustomRpc>(client);
    }

    public dispose() {
        return Promise.all([
            this.p2pContractInstance.removeAllListeners(),
            this.client.dispose()
        ]);
    }

    /**
     * Subscribe to a runtime event (p2p hooks or mirrored `EventHandler`
     * events). Multiple listeners per event are supported; returns an
     * unsubscribe function.
     */
    public on<K extends RuntimeEventName>(
        event: K,
        listener: RuntimeEventMap[K]
    ): () => void {
        return this.client.on(event, listener);
    }

    /** Remove a previously registered runtime-event listener. */
    public off<K extends RuntimeEventName>(
        event: K,
        listener: RuntimeEventMap[K]
    ): void {
        this.client.off(event, listener);
    }

    /**
     * Observe autonomous host-side errors (e.g. a worker-thread
     * unhandledRejection) on the main thread. With no subscriber the error is
     * re-thrown as a main-thread unhandled rejection. Returns an unsubscribe fn.
     */
    public onHostError(listener: (error: Error) => void): () => void {
        return this.client.onHostError(listener);
    }

    /**
     * Drain this peer's host-side detached async work over the port and return
     * any rejections. Lets an orchestrator settle host work uniformly whether
     * the host is inline, in a worker, or remote.
     */
    public quiesce(): Promise<Error[]> {
        return this.client.quiesce();
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
