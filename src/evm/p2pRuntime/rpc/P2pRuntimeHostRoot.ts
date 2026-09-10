import { ChainSignerService } from "./chainSigner/ChainSignerService";
import { DeploySignerService } from "./deploySigner/DeploySignerService";
import { HostRpcMirrorService } from "./hostRpc/HostRpcMirrorService";
import { RuntimeLifecycleService } from "./lifecycle/RuntimeLifecycleService";
import type { P2pRuntimeClientRoot } from "./P2pRuntimeClientRoot";
import { P2pSignerService } from "./p2pSigner/P2pSignerService";
import type EvmDiamondStateMachine from "@/evm/EvmDiamondStateMachine";
import type HostNonceManager from "@/evm/signer/HostNonceManager";
import type LocalContractExecutorSigner from "@/evm/signer/LocalContractExecutorSigner";
import type { RpcRouter } from "@/rpc/RpcRouter";
import type { SerializedError } from "@/rpc/serializeError";
import type StateManager from "@/stateManager/StateManager";
import type ATransport from "@/transport/ATransport";
import type { Logger } from "@/utils/logging/Logger";
import { LogControlService } from "@/utils/logging/rpc/logControl/LogControlService";
import type { ethers } from "ethers";

/** Live runtime graph while the host is running. */
export interface RuntimeHandle {
    stateManager: StateManager;
    evmDiamondStateMachine: EvmDiamondStateMachine;
}

/** what the host's services reach into: the live pieces `startP2pRuntimeHost`
 *  builds, behind accessors that throw until each exists */
export interface RuntimeHost {
    readonly logger: Logger;
    /** the raw wallet: p2p signing and the local state machines */
    readonly signer: ethers.Signer;
    /** the managed real-chain signer: owns this account's nonce */
    readonly chainSigner: HostNonceManager;
    readonly deploySigner: LocalContractExecutorSigner;
    /** throws "Runtime is not ready" before `deployComplete` built it */
    runtime(): RuntimeHandle;
    buildRuntime(
        localStateMachineAddress: string,
        diamondStateMachineAddress: string
    ): Promise<{ webRTCBridge: boolean }>;
    disposeRuntime(): Promise<void>;
    quiesce(): Promise<SerializedError[]>;
    /** the dispose reply is on its way out on `transport`; end the link after it */
    closeAfterReply(transport: ATransport): void;
}

/** what the sdk realm serves to the main thread over the runtime port */
export class P2pRuntimeHostRoot {
    readonly lifecycle: RuntimeLifecycleService;
    readonly p2pSigner: P2pSignerService;
    readonly chainSigner: ChainSignerService;
    readonly deploySigner: DeploySignerService;
    readonly hostRpc: HostRpcMirrorService;
    readonly logControl: LogControlService;

    constructor(
        router: RpcRouter<P2pRuntimeHostRoot, P2pRuntimeClientRoot>,
        host: RuntimeHost
    ) {
        this.lifecycle = new RuntimeLifecycleService(router, host);
        this.p2pSigner = new P2pSignerService(router, host);
        this.chainSigner = new ChainSignerService(router, host);
        this.deploySigner = new DeploySignerService(router, host);
        this.hostRpc = new HostRpcMirrorService(router, host);
        this.logControl = new LogControlService(router, router.logger);
    }
}

export default P2pRuntimeHostRoot;
