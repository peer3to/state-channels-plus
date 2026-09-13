import type { EvmCustomPrecompileManifest } from "@/evm/EvmFactory";
import type { CustomRpcManifest } from "@/rpc/network/registry";
import type { Config } from "@/utils/config";

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
 * Worker-level bootstrap message (NOT a runtime-port message). Sent via
 * `Worker.postMessage` together with the transferred runtime port.
 */
export interface WorkerBootstrapMessage<T = SetupPayload> {
    threadName?: string;
    type: "connect";
    payload: T;
    /** The transferred raw MessagePort (platform-specific); adapted by the worker. */
    port: unknown;
}
