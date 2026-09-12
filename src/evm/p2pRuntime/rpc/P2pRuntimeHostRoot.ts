import { ChainSignerRpcMethods } from "./chainSigner/ChainSignerRpcMethods";
import { DeploySignerRpcMethods } from "./deploySigner/DeploySignerRpcMethods";
import { HostRpcMirrorRpcMethods } from "./hostRpc/HostRpcMirrorRpcMethods";
import { RuntimeLifecycleRpcMethods } from "./lifecycle/RuntimeLifecycleRpcMethods";
import type { P2pRuntimeClientRoot } from "./P2pRuntimeClientRoot";
import { P2pSignerService } from "./p2pSigner/P2pSignerService";
import type EvmDiamondStateMachine from "@/evm/EvmDiamondStateMachine";
import type HostNonceManager from "@/evm/signer/HostNonceManager";
import type LocalContractExecutorSigner from "@/evm/signer/LocalContractExecutorSigner";
import ARpcService from "@/rpc/ARpcService";
import type { RpcRouter } from "@/rpc/RpcRouter";
import type { SerializedError } from "@/rpc/serializeError";
import type StateManager from "@/stateManager/StateManager";
import type MessagePortTransport from "@/transport/MessagePortTransport";
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
    /** the local-VM deploy signer. the client deploys through this line while
     *  the host is still being built, so it is awaited rather than thrown for. */
    deploySigner(): Promise<LocalContractExecutorSigner>;
    /** throws "Runtime is not ready" before `deployComplete` built it */
    runtime(): RuntimeHandle;
    buildRuntime(
        localStateMachineAddress: string,
        diamondStateMachineAddress: string
    ): Promise<{ webRTCBridge: boolean }>;
    disposeRuntime(): Promise<void>;
    quiesce(): Promise<SerializedError[]>;
    /** the dispose reply is on its way out on `transport`; end the link after it */
    closeAfterReply(transport: MessagePortTransport): void;
}

/** what the sdk realm serves to the main thread over the runtime port */
export class P2pRuntimeHostRoot {
    /** the live pieces every endpoint on this root reaches */
    readonly host: RuntimeHost;
    readonly lifecycle: ARpcService<RuntimeLifecycleRpcMethods, any>;
    readonly p2pSigner: P2pSignerService;
    readonly chainSigner: ARpcService<ChainSignerRpcMethods, any>;
    readonly deploySigner: ARpcService<DeploySignerRpcMethods, any>;
    readonly hostRpc: ARpcService<HostRpcMirrorRpcMethods, any>;
    readonly logControl: LogControlService;

    constructor(
        router: RpcRouter<P2pRuntimeHostRoot, P2pRuntimeClientRoot>,
        host: RuntimeHost
    ) {
        this.host = host;
        const logger = router.logger;
        this.lifecycle = new ARpcService(
            router,
            logger,
            RuntimeLifecycleRpcMethods
        );
        this.p2pSigner = new P2pSignerService(router, logger);
        this.chainSigner = new ARpcService(
            router,
            logger,
            ChainSignerRpcMethods
        );
        this.deploySigner = new ARpcService(
            router,
            logger,
            DeploySignerRpcMethods
        );
        this.hostRpc = new ARpcService(router, logger, HostRpcMirrorRpcMethods);
        this.logControl = new LogControlService(router, logger);
    }
}

export default P2pRuntimeHostRoot;
