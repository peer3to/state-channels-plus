import { createRoot, type RootStartContext } from "../createRoot";
import type { RemoteRoot } from "../RemoteRoot";
import type { P2pRuntimeClientRoot } from "./P2pRuntimeClientRoot";
import { WebRTCWorkerBridgeRoot } from "./WebRTCWorkerBridgeRoot";
import { ChainSignerService } from "../services/chainSigner/ChainSignerService";
import { DeploySignerService } from "../services/deploySigner/DeploySignerService";
import { HostRpcService } from "../services/hostRpc/HostRpcService";
import { P2pSignerService } from "../services/p2pSigner/P2pSignerService";
import { SdkSetupService } from "../services/sdkSetup/SdkSetupService";
import Clock from "@/Clock";
import { AContractExecutor } from "@/evm/contractExecutor";
import {
    createContractExecutor,
    type ContractExecutorFactoryOptions
} from "@/evm/contractExecutor/createContractExecutor";
import EvmDiamondStateMachine from "@/evm/EvmDiamondStateMachine";
import { forwardEventHandlerInvocations } from "@/evm/p2pRuntime/host/EventForwarding";
import {
    createRuntimeChainContext,
    type RuntimeChainContext
} from "@/evm/p2pRuntime/RuntimeChainContext";
import type { SetupPayload } from "@/evm/p2pRuntime/types";

import HostNonceManager from "@/evm/signer/HostNonceManager";
import LocalContractExecutorSigner from "@/evm/signer/LocalContractExecutorSigner";
import type { RuntimeConnection } from "@/rpc/internal/AInternalRpcRoot";
import { AInternalRpcRoot } from "@/rpc/internal/AInternalRpcRoot";
import MainRpcService from "@/rpc/network/MainRpcService";
import { resolveCustomRpcConstructor } from "@/rpc/network/resolveCustomRpcManifest";
import { doesWorkerNeedMainThreadBridge } from "@/rpc/network/services/WebRTCSetup/connection/WebRTCProvider";
import WorkerBridgeWebRTCConnectionFactory from "@/rpc/network/services/WebRTCSetup/connection/WorkerBridgeWebRTCConnectionFactory";
import StateManager from "@/stateManager/StateManager";
import Storage from "@/storage";
import { TimeConfig } from "@/types";
import { DebugProxy } from "@/utils";
import { LocalDiscoveryServer } from "@/utils";
import { config, isNodeRuntime } from "@/utils/config";
import { createConfig } from "@/utils/config";
import { LoggerUtils } from "@/utils/LoggerUtils";

import { connectStateChannelManager } from "@/utils/stateChannelManager";
import { reportRootStartupTiming } from "@platform/rootWorkerRuntime";
import type { StateChannelManagerInterface } from "@typechain-types";
import { ethers, type InterfaceAbi } from "ethers";

/**
 * Fully resolved, live context required to build the runtime graph. In inline
 * mode this is constructed directly from the `p2pSetup` arguments; in threaded
 * mode the worker reconstructs it from the serialized {@link SetupPayload}.
 */
export interface HostContext {
    /**
     * When set, this host runs in its own worker thread; the label (e.g. "sdk")
     * tags this thread's event-loop-delay diagnostic reports. Unset for the
     * inline (main-thread) host — the harness's main logger covers that.
     */
    threadLabel?: string;
    /**
     * Builds the contract executor. Internal seam: tests supply a factory that
     * loads a scripted contract-executor worker; production leaves it unset
     * and gets the fixed internal root factory.
     */
    createContractExecutor?: (
        options: ContractExecutorFactoryOptions,
        owner: P2pRuntimeHostRoot
    ) => Promise<AContractExecutor>;
}

/** Live runtime graph while the host is running. */
interface RuntimeHostState {
    stateManager: StateManager;
    evmDiamondStateMachine: EvmDiamondStateMachine;
}

/**
 * In a worker that can't run WebRTC itself, mint the bridge channel, hand the
 * main-thread end to the client (transferred) so it surfaces on
 * `P2pInstance.webRTCBridgePort`, then bind the worker end to its host-owned root.
 */
async function bubbleWebRTCBridgePortIfNeeded(
    remote: RuntimeConnection<P2pRuntimeClientRoot>,
    owner: P2pRuntimeHostRoot
): Promise<WorkerBridgeWebRTCConnectionFactory | undefined> {
    if (!(await doesWorkerNeedMainThreadBridge())) return;
    // The bridge speaks the DOM MessagePort API; in a worker the global
    // MessageChannel works on both web and Node (worker_threads-backed) and its
    // ports transfer over the runtime port.
    const bridge = new MessageChannel();
    // Transfer the main-thread end first: if the post fails we never register a
    // half-installed bridge whose worker end has no paired broker.
    // Transfer the live port capability; JSON cannot preserve a MessagePort.
    remote.sdkClient
        .webRTCBridgePort(bridge.port2)
        .send({ transfer: [bridge.port2] });
    const factory = new WorkerBridgeWebRTCConnectionFactory();
    const workerBridgeRemoteRoot = await createRoot(WebRTCWorkerBridgeRoot, {
        parent: owner,
        mode: "inline",
        args: undefined,
        local: { port: bridge.port1, factory }
    });
    factory.attachBridge(workerBridgeRemoteRoot);
    return factory;
}

/**
 * Construct the live p2p runtime graph and drive it from a {@link RuntimePort}.
 *
 * Requests arriving on the port are dispatched to the state manager / internal
 * signer; p2p event hooks and contract events are forwarded back to the client.
 * Emits a `ready` message once fully constructed.
 */
export class P2pRuntimeHostRoot extends AInternalRpcRoot<P2pRuntimeClientRoot> {
    public chainSigner!: ChainSignerService;
    private webRTCConnectionFactory?: WorkerBridgeWebRTCConnectionFactory;
    public deploySigner!: DeploySignerService;
    public p2pSigner!: P2pSignerService;
    public hostRpc!: HostRpcService;
    public sdkSetup!: SdkSetupService;
    private chainContext?: RuntimeChainContext;
    private contractExecutor?: AContractExecutor;
    private runtimeHandle?: RuntimeHostState;
    private managedSigner!: HostNonceManager;
    private localDeploySigner?: LocalContractExecutorSigner;
    private stateMachineContract!: ethers.Contract;
    private connectedScmContract!: StateChannelManagerInterface;
    private timeConfig!: TimeConfig;
    private disputeExecutionGasLimit!: number;
    // The deployed contract's participant maximum. The queue's retention bound
    // is sized from it, so the chain stays authoritative for both.
    private maxChannelParticipants!: number;
    private signerAddress!: string;
    private readonly context: HostContext;

    constructor(
        private readonly payload: SetupPayload,
        local: HostContext = {},
        context: RootStartContext
    ) {
        // Restore worker configuration before common logger construction.
        if (context.mode === "worker") createConfig(payload.config);
        super(
            (error) => {
                // Parent closure during disposal must not restart the worker error funnel.
                if (this.isDisposing) {
                    try {
                        this.rootLogger.error("SDK error during cleanup", {
                            error
                        });
                    } catch {
                        // Its logger may already be disposed after the parent closed.
                    }
                    return;
                }
                this.rootLogger?.error("Unhandled SDK runtime error", {
                    error
                });
                throw error;
            },
            30_000,
            context
        );
        this.context = {
            ...local,
            threadLabel:
                context.mode === "worker" ? globalThis.threadName : undefined
        };
    }

    public async start(): Promise<void> {
        const runtimeStartedAt = Date.now();
        const payload = this.payload;
        const ctx = this.context;
        const { threadLabel } = ctx;
        // Provider creation happens before the rest of the runtime graph exists,
        // but its failure must still settle the paired client's `ready` promise.
        this.chainContext = await createRuntimeChainContext(
            payload.config,
            payload.signerSecret
        );
        const { signer } = this.chainContext;
        const signerAddress = (this.signerAddress = await signer.getAddress());
        const logger = this.rootLogger;
        logger.updateSharedContext({
            peerId: payload.peerId,
            peerAddress: signerAddress
        });

        // Own this account's nonce so the peer's concurrent async flows can't collide
        // on it (the REPLACEMENT_UNDERPRICED race). Used only for the real-chain SCM
        // send + retry paths below; the local-VM signers (deploy/executor, p2p) and
        // the read-only Clock stay on the raw signer.
        const chainSigner = (this.managedSigner = new HostNonceManager(
            signer,
            logger
        ));

        const scmContract = connectStateChannelManager(
            payload.scm.address,
            chainSigner,
            JSON.parse(payload.scm.abiJson) as InterfaceAbi
        );
        this.stateMachineContract = new ethers.Contract(
            payload.stateMachine.address,
            JSON.parse(payload.stateMachine.abiJson),
            signer
        );

        // Sync clock to DLT.
        await Clock.init(signer.provider!);

        // Connect the managed signer to the state channel manager contract so every
        // on-chain SCM send draws its nonce from the owned counter.
        let connectedScmContract = scmContract;
        if (payload.config.DEBUG_CHANNEL_CONTRACT) {
            connectedScmContract = DebugProxy.createProxy(connectedScmContract);
        }

        // Resolve time configuration from the SCM proxy.
        const configTimes = await connectedScmContract.getAllTimes();
        const timeConfig: TimeConfig = (this.timeConfig = {
            p2pTime: Number(configTimes[0]),
            agreementTime: Number(configTimes[1]),
            chainFallbackTime: Number(configTimes[2]),
            evidenceTime: Number(configTimes[3])
        });
        this.disputeExecutionGasLimit = Number(
            await connectedScmContract.getGasLimit()
        );
        this.maxChannelParticipants = Number(
            await connectedScmContract.getMaxChannelParticipants()
        );
        if (
            !Number.isSafeInteger(this.maxChannelParticipants) ||
            this.maxChannelParticipants < 1
        ) {
            throw new Error(
                "Deployed maximum participant count is not a positive safe integer"
            );
        }
        await LoggerUtils.logTimestamp(logger, "info", timeConfig);

        this.connectedScmContract = connectedScmContract;
        this.chainSigner = new ChainSignerService(this.router, chainSigner);
        this.deploySigner = new DeploySignerService(
            this.router,
            () => this.localDeploySigner!
        );
        this.p2pSigner = new P2pSignerService(
            this.router,
            () => this.requireManager().p2pSigner,
            signer
        );
        this.hostRpc = new HostRpcService(this.router, () =>
            this.requireManager()
        );
        this.sdkSetup = new SdkSetupService(
            this.router,
            (local, diamond) => this.buildRuntime(local, diamond),
            logger
        );
        // A detached error inside the contract-executor worker is reported the
        // way the sdk worker's own detached errors are: one host error report, and the
        // executor keeps serving.
        this.contractExecutor = await (
            ctx.createContractExecutor ?? createContractExecutor
        )(
            {
                dedicatedThread: payload.config.VM_DEDICATED_THREAD,
                customPrecompiles: payload.customPrecompiles,
                logger: payload.config.VM_DEDICATED_THREAD
                    ? undefined
                    : logger.child({ component: "ContractExecutor" })
            },
            this
        );
        this.localDeploySigner = new LocalContractExecutorSigner(
            signer,
            this.contractExecutor
        );

        // A bridge-setup failure must not deadlock `ready`; WebRTC is optional.
        try {
            if (this.parent)
                this.webRTCConnectionFactory =
                    await bubbleWebRTCBridgePortIfNeeded(this.parent.rpc, this);
        } catch (error) {
            logger.error("WebRTC bridge setup failed; continuing without it", {
                error
            });
        }
        reportRootStartupTiming({
            runtimeReadyMs: Date.now() - runtimeStartedAt,
            ...(threadLabel ? { runtimeThread: threadLabel } : {})
        });
    }

    private requireManager() {
        if (!this.runtimeHandle) throw new Error("Runtime is not ready");
        return this.runtimeHandle.stateManager.p2pManager;
    }

    private async buildRuntime(
        localStateMachineAddress: string,
        diamondStateMachineAddress: string
    ): Promise<void> {
        const payload = this.payload;
        const contractExecutor = this.contractExecutor;
        const stateMachineContract = this.stateMachineContract;
        const signer = this.chainContext!.signer;
        const timeConfig = this.timeConfig;
        const disputeExecutionGasLimit = this.disputeExecutionGasLimit;
        const chainSigner = this.managedSigner;
        const signerAddress = this.signerAddress;
        const connectedScmContract = this.connectedScmContract;
        const logger = this.rootLogger;
        const remote = this.parent?.rpc;
        const handlerExecutionContext = this.handlerExecutionContext;
        const customRpcResolved = await resolveCustomRpcConstructor<
            MainRpcService,
            unknown
        >(payload.customRpcManifest);

        const { evmDiamondStateMachine } =
            await EvmDiamondStateMachine.createStandaloneFromLocalStateMachineWithExecutor(
                contractExecutor!,
                localStateMachineAddress,
                diamondStateMachineAddress,
                stateMachineContract.interface,
                signer,
                timeConfig,
                disputeExecutionGasLimit
            );

        const storage = new Storage(this.maxChannelParticipants);

        const stateManager = new StateManager<MainRpcService, unknown>(
            // Managed signer: becomes StateManager.signer → DisputeManager.signer,
            // covering the raw evmErrorHandler retry send so it can't bypass the
            // owned nonce counter and re-open the race.
            chainSigner,
            signerAddress,
            connectedScmContract,
            evmDiamondStateMachine,
            timeConfig,
            // The app's hooks live on the main thread; the worker realm
            // publishes through the bus and the bridge tap below forwards
            // every event over the port.
            {},
            storage,
            logger,
            () => this.dispose(),
            customRpcResolved?.customRpc,
            customRpcResolved?.customRpcOptions
        );

        if (this.webRTCConnectionFactory)
            stateManager.p2pManager.localRpc.webRTCSetupService.setConnectionFactory(
                this.webRTCConnectionFactory
            );
        evmDiamondStateMachine.setStateManager(stateManager);

        // The single port bridge: every bus emission crosses as one
        // uniform payload. It runs after all local listeners; a clone
        // failure propagates to the producer (posting after close is a
        // silent drop on Node -- remote closure is handled by onClose).
        stateManager.events.setBridgeTap((kind, eventName, args) =>
            remote?.sdkClient.busEvent(kind, eventName, args).send()
        );

        forwardEventHandlerInvocations(
            stateManager.eventHandler,
            stateManager.events,
            handlerExecutionContext
        );

        if (handlerExecutionContext) {
            const p2pManager = stateManager.p2pManager;
            const onRpc = p2pManager.rpcRouter.onRpc.bind(p2pManager.rpcRouter);
            p2pManager.rpcRouter.onRpc = (serializedRpc, transport) =>
                handlerExecutionContext.runHandler(() =>
                    onRpc(serializedRpc, transport)
                );
        }

        this.runtimeHandle = { stateManager, evmDiamondStateMachine };
        await stateManager.p2pManager.localRpc.ready();
    }

    // Overrides AInternalRpcRoot.isDisposed to include domain abort before root cleanup starts.
    public override get isDisposed(): boolean {
        return (
            super.isDisposed ||
            (this.runtimeHandle?.stateManager.isDisposed ?? false)
        );
    }

    // Implements root cleanup through the shared recursive disposal contract.
    public override dispose(): Promise<void> {
        return this.disposeRoot(
            async () => {
                const runtimeHandle = this.runtimeHandle;
                const provider = this.chainContext?.provider;
                const ctx = this.context;
                // Reported before the provider closes; the settle is bounded
                // so disposal never hangs on the chain.
                if (this.managedSigner) {
                    this.rootLogger.info(
                        "gas usage",
                        LoggerUtils.getGasUsageMetadata(
                            await this.managedSigner.gasUsage.settledSnapshot(
                                config.GAS_USAGE_SETTLE_MS
                            )
                        )
                    );
                    // The report is out; end the receipt waits still running
                    // before the provider that would never end them closes.
                    this.managedSigner.gasUsage.dispose();
                }
                try {
                    try {
                        // Destroy first so ethers marks the provider closed before its
                        // listener cleanup schedules unsubscribe microtasks. Explicitly
                        // removing listeners first leaves eth_unsubscribe requests that
                        // destroy then rejects as unhandled.
                        if (provider && !Clock.ownsProvider(provider))
                            await provider.destroy();
                    } finally {
                        if (runtimeHandle) {
                            await runtimeHandle.stateManager.dispose();
                        }
                    }
                } finally {
                    this.closeChildConnections();
                    try {
                        // TODO: Delegate cleanup through the shared Holepunch/local
                        // discovery lifecycle API once the backend is injected.
                        if (
                            ctx.threadLabel &&
                            config.DEBUG_LOCAL_TRANSPORT &&
                            isNodeRuntime() &&
                            config.LOCAL_DISCOVERY_REGISTRY_URL
                        ) {
                            await LocalDiscoveryServer.cleanup();
                        }
                    } finally {
                        // Late network callbacks must not use the disposed parent connection.
                        runtimeHandle?.stateManager.events.setBridgeTap(
                            undefined
                        );
                    }
                }
            },
            () => this.runtimeHandle?.stateManager.stop()
        );
    }
}

export type P2pRuntimeHostRemoteRoot = RemoteRoot<P2pRuntimeHostRoot>;
