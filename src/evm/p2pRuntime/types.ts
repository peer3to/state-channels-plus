import type { Config } from "@/utils/config";
import type { EvmCustomPrecompileManifest } from "@/evm/EvmFactory";
import type { CustomRpcManifest } from "@/rpc/registry";
import type { RuntimeRequestInput } from "./worker/protocol";

/** the port surface a runtime link runs on; owned by the transport layer */
export type { RuntimePort, RuntimeChannel } from "@/transport/RuntimePort";

/** Serializable description of a deployed contract the host can rebuild. */
export interface SerializedContract {
    address: string;
    /**
     * JSON-encoded ABI supplied by the application. For the manager, both
     * runtime sides merge it after the SDK-owned manager ABI.
     */
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
    shutdown(): Promise<void>;
}

/** `Omit` that distributes over unions (preserves discriminated members). */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
    ? Omit<T, K>
    : never;

/** Serializable error shape carried in failed runtime responses. */
export type { SerializedError } from "@/rpc/serializeError";

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
    RuntimeBusEventMessage,
    RuntimeClientMessage,
    RuntimeClientRequest,
    RuntimeHostErrorMessage,
    RuntimeHostMessage,
    RuntimeLogControlMessage,
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
