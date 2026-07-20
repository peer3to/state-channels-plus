import type P2pEventHooks from "@/P2pEventHooks";
import type {
    DistributiveOmit,
    RuntimeRequest,
    SerializedError,
    SetupPayload
} from "../types";
import type { SerializedTransactionRequest } from "../chainSignerSerialization";

/**
 * Worker-level bootstrap message (NOT a runtime-port message). Sent via
 * `Worker.postMessage` together with the transferred runtime port.
 */
export interface WorkerBootstrapMessage {
    type: "connect";
    payload: SetupPayload;
    /** The transferred raw MessagePort (platform-specific); adapted by the worker. */
    port: unknown;
}

export interface SendTransactionRequest
    extends RuntimeRequest<"sendTransaction"> {
    /** Raw calldata (hex). The host builds the transaction header and block. */
    data: string;
}

export interface CallViewRequest extends RuntimeRequest<"callView"> {
    /** Raw calldata (hex) for a read-only call. */
    data: string;
}

export interface ConnectToChannelRequest
    extends RuntimeRequest<"connectToChannel"> {
    channelId: string;
}

export interface JoinChannelRequest extends RuntimeRequest<"joinChannel"> {
    encodedJoinChannelConfirmation: string;
    expectedSnapshotHash: string;
    expectedForkId: string;
}

export interface TopUpBalanceRequest extends RuntimeRequest<"topUpBalance"> {
    encodedJoinChannelConfirmation: string;
    expectedSnapshotHash: string;
    expectedForkId: string;
}

export interface CollectJoinChannelConfirmationRequest
    extends RuntimeRequest<"collectJoinChannelConfirmation"> {
    encodedJoinChannel: string;
}

export interface SetChannelIdRequest extends RuntimeRequest<"setChannelId"> {
    channelId: string;
}

export type GetChannelStatusRequest = RuntimeRequest<"getChannelStatus">;

export interface SetIsLeaderRequest extends RuntimeRequest<"setIsLeader"> {
    value: boolean;
}

export type DisconnectFromPeersRequest = RuntimeRequest<"disconnectFromPeers">;

export interface SignMessageRequest extends RuntimeRequest<"signMessage"> {
    /** Hex-encoded bytes or a UTF-8 string to sign. */
    message: string;
}

export interface SignTypedDataRequest extends RuntimeRequest<"signTypedData"> {
    domain: unknown;
    types: unknown;
    value: unknown;
}

export interface ChainSignerSignTransactionRequest
    extends RuntimeRequest<"chainSignerSignTransaction"> {
    serializedTransaction: SerializedTransactionRequest;
}

export interface ChainSignerSendTransactionRequest
    extends RuntimeRequest<"chainSignerSendTransaction"> {
    serializedTransaction: SerializedTransactionRequest;
}

export interface ChainSignerSignMessageRequest
    extends RuntimeRequest<"chainSignerSignMessage"> {
    message:
        | { kind: "string"; value: string }
        | { kind: "bytes"; encodedBytes: string };
}

export interface ChainSignerSignTypedDataRequest
    extends RuntimeRequest<"chainSignerSignTypedData"> {
    domain: unknown;
    types: unknown;
    value: unknown;
}

export type DeploySignerGetAddressRequest =
    RuntimeRequest<"deploySignerGetAddress">;

export type DeploySignerGetNonceRequest =
    RuntimeRequest<"deploySignerGetNonce">;

export interface DeploySignerResolveNameRequest
    extends RuntimeRequest<"deploySignerResolveName"> {
    name: string;
}

export interface DeploySignerCallRequest
    extends RuntimeRequest<"deploySignerCall"> {
    tx: unknown;
}

export interface DeploySignerSendTransactionRequest
    extends RuntimeRequest<"deploySignerSendTransaction"> {
    tx: unknown;
}

export interface DeployCompleteRequest
    extends RuntimeRequest<"deployComplete"> {
    /** State machine instance backing the replicated working state. */
    localStateMachineAddress: string;
    /** Separate state machine instance embedded in the LocalDiamond. */
    diamondStateMachineAddress: string;
}

export type DisposeRequest = RuntimeRequest<"dispose">;

/**
 * Drain the host's detached promises and report any that rejected. Lets the
 * orchestrator settle host-side async work over the port instead of reaching
 * into a realm-local global — uniform whether the host is inline, in a worker,
 * or remote. Returns `SerializedError[]`.
 */
export type QuiesceRequest = RuntimeRequest<"quiesce">;

/**
 * Mobile reconnect: recover this host's channel after coming back from
 * background — rejoin the topic, hydrate storage, resync through a connected
 * peer. See `P2PManager.resumeFromBackground`. Returns `ResumeResult`.
 */
export type ResumeFromBackgroundRequest =
    RuntimeRequest<"resumeFromBackground">;

/**
 * Mirrors a `hostRpc.<service>.<method>(...params).<delivery>(...args)` call
 * invoked from the client. The port is a pure proxy: the host replays the exact
 * same chained call on its live `remoteRpc` and (for `request`) awaits and
 * returns the result. Target semantics are the host's: an omitted target runs
 * the method on the host itself (loopback); a peer address relays it.
 *
 * `delivery` is whatever method the caller invoked on the RPC handle (e.g.
 * `request`/`sendOne`/`broadcast`); it is forwarded verbatim so new handler
 * methods need no changes here.
 */
export interface HostRpcRequest extends RuntimeRequest<"hostRpc"> {
    service: string;
    method: string;
    params: unknown[];
    /** Name of the delivery method invoked on the resolved RPC handle. */
    delivery: string;
    /** Arguments passed to the delivery method (e.g. `[target?, options?]`). */
    args: unknown[];
}

/** Union of all client→host requests. */
export type RuntimeClientRequest =
    | SendTransactionRequest
    | CallViewRequest
    | ConnectToChannelRequest
    | JoinChannelRequest
    | TopUpBalanceRequest
    | CollectJoinChannelConfirmationRequest
    | SetChannelIdRequest
    | GetChannelStatusRequest
    | SetIsLeaderRequest
    | DisconnectFromPeersRequest
    | SignMessageRequest
    | SignTypedDataRequest
    | ChainSignerSignTransactionRequest
    | ChainSignerSendTransactionRequest
    | ChainSignerSignMessageRequest
    | ChainSignerSignTypedDataRequest
    | DeploySignerGetAddressRequest
    | DeploySignerGetNonceRequest
    | DeploySignerResolveNameRequest
    | DeploySignerCallRequest
    | DeploySignerSendTransactionRequest
    | DeployCompleteRequest
    | HostRpcRequest
    | QuiesceRequest
    | ResumeFromBackgroundRequest
    | DisposeRequest;

/** A request without its correlation id, as supplied by callers. */
export type RuntimeRequestInput = DistributiveOmit<
    RuntimeClientRequest,
    "requestId"
>;

/** Host→client response correlated to a request by `requestId`. */
export type RuntimeResponse =
    | { type: "response"; requestId: number; ok: true; result: unknown }
    | {
          type: "response";
          requestId: number;
          ok: false;
          error: SerializedError;
      };

/** Host→client signal emitted once the runtime is fully constructed. */
export interface RuntimeReadyMessage {
    type: "ready";
}

/** Host→client p2p event hook invocation, dispatched to client listeners. */
export interface RuntimeP2pEventHookMessage {
    type: "p2pEventHook";
    name: keyof P2pEventHooks;
    args: unknown[];
}

/** Host→client contract event, re-emitted on the main-thread contract. */
export interface RuntimeContractEventMessage {
    type: "contractEvent";
    name: string;
    args: unknown[];
}

/**
 * Host→client mirror of an `EventHandler` invocation, fired after the handler
 * resolves. `args` is a best-effort clone, empty when not serializable.
 */
export interface RuntimeEventHandlerMessage {
    type: "eventHandlerInvoked";
    name: string;
    args: unknown[];
}

/**
 * Host→client surfacing of an autonomous host-side failure (an
 * unhandledRejection / uncaughtException not tied to a request). Lets the
 * main-thread orchestrator observe worker-thread errors as if they were local.
 */
export interface RuntimeHostErrorMessage {
    type: "hostError";
    error: SerializedError;
}

/**
 * Host→client hand-off of the main-thread end of the WebRTC bridge
 * `MessageChannel`. Emitted (with `port` in the transfer list) only when the
 * host runs in a worker that cannot negotiate WebRTC itself, so the caller can
 * forward the port up to the real main thread and bind it to the bridge.
 */
export interface RuntimeWebRTCBridgePortMessage {
    type: "webRTCBridgePort";
    port: MessagePort;
}

/** Union of all host→client messages. */
export type RuntimeHostMessage =
    | RuntimeReadyMessage
    | RuntimeResponse
    | RuntimeP2pEventHookMessage
    | RuntimeContractEventMessage
    | RuntimeEventHandlerMessage
    | RuntimeHostErrorMessage
    | RuntimeWebRTCBridgePortMessage;

export type P2pRuntimeRequestMessage = RuntimeClientRequest;
export type P2pRuntimeHostMessage = RuntimeHostMessage;
export type P2pRuntimeBootstrapMessage = WorkerBootstrapMessage;
