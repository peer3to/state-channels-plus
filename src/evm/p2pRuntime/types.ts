import type { Config } from "@/utils/config";
import type { EvmCustomPrecompileManifest } from "@/evm/EvmFactory";
import type { CustomRpcManifest } from "@/rpc/registry";

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

/**
 * Worker-level bootstrap message (NOT a runtime-port frame). Sent via
 * `Worker.postMessage` together with the transferred runtime port - the one
 * message that carries ownership across, which an RPC envelope cannot.
 */
export interface WorkerBootstrapMessage {
    type: "connect";
    payload: SetupPayload;
    /** The transferred raw MessagePort (platform-specific); adapted by the worker. */
    port: unknown;
    /** the worker end of the WebRTC bridge channel, transferred alongside */
    webRTCBridgePort: unknown;
}

/**
 * Minimal, platform-neutral worker handle. Both Node `worker_threads` `Worker`
 * and the browser `Worker` structurally satisfy this interface.
 */
export interface P2pRuntimeWorker {
    postMessage(value: unknown, transfer?: unknown[]): void;
    shutdown(): Promise<void>;
}

/** Serializable error shape carried in failed runtime replies. */
export type { SerializedError } from "@/rpc/serializeError";
