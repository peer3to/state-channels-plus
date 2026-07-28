import type { Config } from "@/utils/config";
import type { EvmCustomPrecompileManifest } from "@/evm/EvmFactory";
import type { CustomRpcManifest } from "@/rpc/registry";
import type { RuntimeRequestInput } from "./worker/protocol";
import type {
    PersistenceOptions,
    PersistencePartitionIdentity
} from "@/storage/persistence";

/**
 * Transport definitions for the p2p runtime channel.
 */

/**
 * A minimal transport surface implemented by both Node `worker_threads`
 * `MessagePort` and the browser `MessagePort`.
 */
export interface RuntimePort {
    /** Send a message, optionally transferring ownership of transferables. */
    post(message: unknown, transfer?: unknown[]): void;
    /** Register the single message handler for inbound messages. */
    onMessage(handler: (message: unknown) => void): void;
    /** Begin dispatching messages (no-op where not required). */
    start(): void;
    /**
     * Register a handler for when the other end goes away. Reliable on Node;
     * best-effort in the browser, so callers keep a request timeout as backstop.
     */
    onClose(handler: () => void): void;
    /** Tear down the port. */
    close(): void;
}

/** A linked pair of ports. `port1` stays local; `port2` may be transferred. */
export interface RuntimeChannel {
    port1: RuntimePort;
    port2: RuntimePort;
}

/** Serializable description of a deployed contract the host can rebuild. */
export interface SerializedContract {
    address: string;
    /** JSON-encoded ABI (ethers `Interface`-compatible fragments). */
    abiJson: string;
}

/**
 * Fully serializable payload describing how to (re)build the runtime.
 */
export interface SetupPayload {
    config: Config;
    /** State channel manager proxy contract. */
    scm: SerializedContract;
    /** Application state machine contract. */
    stateMachine: SerializedContract;
    /**
     * Signer secret (private key or mnemonic) used to reconstruct the same
     * `ethers.Wallet` inside the host.
     */
    signerSecret: string;
    persistence?: {
        options: PersistenceOptions;
        identity: Omit<PersistencePartitionIdentity, "channelId">;
        channelId?: string;
    };
    peerId?: number;
    /** Optional dynamic custom RPC manifest resolved on the host side. */
    customRpcManifest?: CustomRpcManifest;
    /** Optional custom precompile manifests forwarded to the contract executor. */
    customPrecompiles?: EvmCustomPrecompileManifest[];
}

/** Request envelope: every client→host request carries a correlation id. */
export interface RuntimeRequest<TType extends string = string> {
    requestId: number;
    type: TType;
}

/**
 * Minimal, platform-neutral worker handle. Both Node `worker_threads` `Worker`
 * and the browser `Worker` structurally satisfy this interface.
 */
export interface P2pRuntimeWorker {
    postMessage(value: unknown, transfer?: unknown[]): void;
    terminate(): unknown;
}

/** `Omit` that distributes over unions (preserves discriminated members). */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
    ? Omit<T, K>
    : never;

/** Serializable error shape carried in failed runtime responses. */
export interface SerializedError {
    message: string;
    name?: string;
    stack?: string;
    data?: string;
    /** Ethers error metadata restored on the client for classification. */
    code?: string;
    shortMessage?: string;
    info?: unknown;
    action?: string;
    reason?: string;
    transaction?: unknown;
    receipt?: unknown;
    /**
     * EVM address of the peer host the error originated on, when stamped (see
     * `errorPeerAddress`). Carried explicitly because the in-process stamp
     * doesn't survive the structured-clone hop across the port.
     */
    peerAddress?: string;
}

/** Minimal surface needed to issue requests to the host. */
export interface RuntimeRequester {
    request<TResult>(
        request: RuntimeRequestInput,
        options?: { timeoutMs?: number | null }
    ): Promise<TResult>;
}

export type {
    CallViewRequest,
    ChainSignerSendTransactionRequest,
    ChainSignerSignMessageRequest,
    ChainSignerSignTransactionRequest,
    ChainSignerSignTypedDataRequest,
    ConnectToChannelRequest,
    CollectJoinChannelConfirmationRequest,
    HostRpcRequest,
    DeployCompleteRequest,
    DeploySignerCallRequest,
    DeploySignerGetAddressRequest,
    DeploySignerGetNonceRequest,
    DeploySignerResolveNameRequest,
    DeploySignerSendTransactionRequest,
    DisconnectFromPeersRequest,
    DisposeRequest,
    GetChannelStatusRequest,
    JoinChannelRequest,
    TopUpBalanceRequest,
    P2pRuntimeBootstrapMessage,
    P2pRuntimeHostMessage,
    P2pRuntimeRequestMessage,
    RuntimeClientRequest,
    RuntimeContractEventMessage,
    RuntimeEventHandlerMessage,
    RuntimeHostErrorMessage,
    RuntimeHostMessage,
    RuntimeP2pEventHookMessage,
    RuntimeReadyMessage,
    RuntimeRequestInput,
    RuntimeResponse,
    RuntimeWebRTCBridgePortMessage,
    SendTransactionRequest,
    SetChannelIdRequest,
    SetIsLeaderRequest,
    SignMessageRequest,
    SignTypedDataRequest,
    WorkerBootstrapMessage
} from "./worker/protocol";
