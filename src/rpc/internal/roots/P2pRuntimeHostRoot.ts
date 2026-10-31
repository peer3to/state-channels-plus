import { createRoot, type RootStartContext } from "../createRoot";
import type { P2pRuntimeClientRoot } from "./P2pRuntimeClientRoot";
import { WebRTCWorkerBridgeRoot } from "./WebRTCWorkerBridgeRoot";
import { ChainSignerService } from "../services/chainSigner/ChainSignerService";
import { DeploySignerService } from "../services/deploySigner/DeploySignerService";
import { HostRpcService } from "../services/hostRpc/HostRpcService";
import { P2pSignerService } from "../services/p2pSigner/P2pSignerService";
import { SdkSetupService } from "../services/sdkSetup/SdkSetupService";
import Clock from "@/Clock";
import { AContractExecutor } from "@/evm/contractExecutor";
import { localEvmCallGasLimit } from "@/evm/contractExecutor/ContractExecutor";
import {
    createContractExecutor,
    type ContractExecutorFactoryConfiguration,
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
import { RootDisposedError } from "@/rpc/internal/RemoteRoot";
import MainRpcService, {
    type ApplicationEventsOf
} from "@/rpc/network/MainRpcService";
import { resolveCustomRpcConstructor } from "@/rpc/network/resolveCustomRpcManifest";
import { doesWorkerNeedMainThreadBridge } from "@/rpc/network/services/WebRTCSetup/connection/WebRTCProvider";
import WorkerBridgeWebRTCConnectionFactory from "@/rpc/network/services/WebRTCSetup/connection/WorkerBridgeWebRTCConnectionFactory";
import StateManager from "@/stateManager/StateManager";
import Storage from "@/storage";
import { TimeConfig } from "@/types";
import { DebugProxy } from "@/utils";
import { LocalDiscoveryServer } from "@/utils";
import { config, createConfig, isNodeRuntime } from "@/utils/config";
import { LoggerUtils } from "@/utils/LoggerUtils";
import { runCleanup } from "@/utils/runCleanup";

import { connectStateChannelManager } from "@/utils/stateChannelManager";
import { StepTimer } from "@/utils/StepTimer";
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

/** Type-only key of the network root class a host root serves. */
declare const applicationType: unique symbol;

/** The network root (custom RPC) class a host root class serves. */
export type ApplicationOf<THost extends P2pRuntimeHostRoot> =
    THost[typeof applicationType];

/** The application event map a host root's network root declares. */
export type HostEventsOf<THost extends P2pRuntimeHostRoot> =
    ApplicationEventsOf<ApplicationOf<THost>>;

/**
 * Construct the live p2p runtime graph and drive it from a {@link RuntimePort}.
 *
 * Requests arriving on the port are dispatched to the state manager / internal
 * signer; p2p event hooks and contract events are forwarded back to the client.
 * Emits a `ready` message once fully constructed.
 *
 * An application extends this root the way it extends `MainRpcService`: its
 * subclass adds internal services as typed fields and reaches its custom RPC
 * (`TApplication`, which also declares the application events) through
 * {@link application}. A host root manifest names the subclass; the SDK loads
 * it in the runtime's realm.
 */
export class P2pRuntimeHostRoot<
    TApplication extends MainRpcService = MainRpcService
> extends AInternalRpcRoot<P2pRuntimeClientRoot> {
    /** Type-only: carries `TApplication` to the client; never set at runtime. */
    declare public readonly [applicationType]: TApplication;
    public chainSigner!: ChainSignerService;
    private webRTCConnectionFactory?: WorkerBridgeWebRTCConnectionFactory;
    public deploySigner!: DeploySignerService;
    public p2pSigner!: P2pSignerService;
    public hostRpc!: HostRpcService;
    public sdkSetup!: SdkSetupService;
    private chainContext?: RuntimeChainContext;
    private contractExecutor?: AContractExecutor;
    private runtimeHandle?: RuntimeHostState;
    /** The network teardown the cut started. */
    private networkClose?: Promise<void>;
    private runtimeRelease?: Promise<void>;
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
    private readonly payload: SetupPayload;

    constructor(
        payload: SetupPayload,
        local: HostContext = {},
        context: RootStartContext
    ) {
        // A worker's bootstrap applies the config to the entry's module graph.
        // A host root bundled apart from that entry has its own copy of the
        // config module, so the root applies its own peer's configuration to
        // its graph before its logger reads it; with one shared graph this
        // reapplies the same values.
        if (context.mode === "worker") createConfig(payload.config);
        super(
            (error) => {
                // Parent closure during disposal must not restart the worker error funnel.
                if (this.isDisposing) {
                    this.rootLogger.error("SDK error during cleanup", {
                        error
                    });
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
        this.payload = payload;
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
        const logger = this.rootLogger;
        // Where a slow start goes; the setup's own bound counts all of it.
        const steps = new StepTimer(
            () => this.chainContext?.provider.requestCount ?? 0
        );
        // The executor starts first and builds its EVM while this root connects
        // and reads the chain; the chain reads' configuration reaches it after.
        let configure!: (
            configuration: ContractExecutorFactoryConfiguration
        ) => void;
        let failConfiguration!: (error: unknown) => void;
        const configuration = new Promise<ContractExecutorFactoryConfiguration>(
            (resolve, reject) => {
                configure = resolve;
                failConfiguration = reject;
            }
        );
        // A detached error inside the contract-executor worker is reported the
        // way the sdk worker's own detached errors are: one host error report, and the
        // executor keeps serving.
        const executorCreation = (
            ctx.createContractExecutor ?? createContractExecutor
        )(
            {
                dedicatedThread: payload.config.VM_DEDICATED_THREAD,
                customPrecompiles: payload.customPrecompiles,
                configuration,
                logger: payload.config.VM_DEDICATED_THREAD
                    ? undefined
                    : logger.child({ component: "ContractExecutor" })
            },
            this
        );
        // Awaited below; a start that fails first leaves it to this root's
        // disposal. The factory may still be starting the executor when the
        // configuration fails, so that failure is handled here too.
        executorCreation.catch(() => undefined);
        configuration.catch(() => undefined);
        try {
            configure({ callGasLimit: await this.readChain(steps) });
        } catch (error) {
            failConfiguration(error);
            throw error;
        }
        const { signer } = this.chainContext!;
        const chainSigner = this.managedSigner!;
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
        this.contractExecutor = await executorCreation;
        steps.mark("contractExecutor");
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
        steps.mark("webRTCBridge");
        steps.log(logger, "Runtime host start steps");
        reportRootStartupTiming({
            runtimeReadyMs: Date.now() - runtimeStartedAt,
            ...(threadLabel ? { runtimeThread: threadLabel } : {})
        });
    }

    /**
     * The one disposal: the cut, then each edge of the runtime that outlives
     * it released once, here. Everything else is in memory and dropped.
     */
    public override dispose(): Promise<void> {
        const disposal = this.disposeRoot(
            () => {
                const provider = this.chainContext?.provider;
                const ctx = this.context;
                return runCleanup(
                    // Reported before the provider closes; the settle is bounded
                    // so disposal never hangs on the chain.
                    async () => {
                        if (!this.managedSigner) return;
                        this.rootLogger.info(
                            "gas usage",
                            LoggerUtils.getGasUsageMetadata(
                                await this.managedSigner.gasUsage.settledSnapshot(
                                    config.GAS_USAGE_SETTLE_MS
                                )
                            )
                        );
                    },
                    async () => {
                        // Destroy first so ethers sends no eth_unsubscribe the destroy
                        // would cancel; node sockets settle any that are sent (NodeSocket).
                        if (provider && !Clock.ownsProvider(provider))
                            await provider.destroy();
                        // The Clock keeps reading through it, but this
                        // runtime's node reconnects and their logs end here;
                        // the Clock destroys it once a new provider replaces it.
                        else if (provider) {
                            provider.stopReconnecting();
                            Clock.releaseProvider(provider);
                        }
                    },
                    // a close failure fails the disposal
                    () => this.networkClose,
                    () => this.closeChildConnections(),
                    async () => {
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
                    }
                );
            },
            () => this.releaseRuntime()
        );
        this.cutOff(); // before disposeRoot's first await
        return disposal;
    }

    /**
     * The live custom RPC of this runtime; rejects with "Runtime is not ready"
     * before the runtime is built.
     */
    protected get application(): TApplication {
        // The custom RPC manifest fixes the class at runtime; the subclass
        // names its type.
        return this.requireManager().localRpc as TApplication;
    }

    private requireManager() {
        if (!this.runtimeHandle) throw new Error("Runtime is not ready");
        return this.runtimeHandle.stateManager.p2pManager;
    }

    /**
     * Cut network, chain sends and the parent bus in one step;
     * nothing the runtime does afterwards leaves it. Parent replies and the
     * logger channel stay open. Every step is idempotent.
     */
    private cutOff(): void {
        const stateManager = this.runtimeHandle?.stateManager;
        if (stateManager) stateManager.isDisposed = true;
        // the cleanup awaits the network teardown's outcome
        this.networkClose = stateManager?.p2pManager.dispose();
        this.networkClose?.catch(() => undefined);
        this.managedSigner?.cut();
        stateManager?.events.setBridgeTap(undefined);
        this.handlerExecutionContext?.dispose?.();
        this.rootLogger.updateSharedContext({ disposing: true });
    }

    /**
     * Before the children: the runtime's timers, its pending app answers
     * and the waits that hold timers or chain listeners end, and an abort's
     * log flush completes while the workers can still upload. Runs once.
     */
    private releaseRuntime(): Promise<void> | undefined {
        const stateManager = this.runtimeHandle?.stateManager;
        if (!stateManager) return;
        const localRpc = stateManager.p2pManager.localRpc;
        return (this.runtimeRelease ??= runCleanup(
            // the custom RPC's own hook, before its child roots are disposed
            () => localRpc.dispose(),
            // the app's pending open-channel attempt answers cancelled
            () => localRpc.openChannelNegotiationService.dispose(),
            // a pending match answers undefined and leaves its discovery session
            () => localRpc.lobbyMatchingService.dispose(),
            // pending handshake waits settle and their timers clear
            () => localRpc.initHandshakeService.dispose(),
            // ends the chain-head waits (timer and block listener)
            () => localRpc.spectateService.dispose(),
            () => stateManager.timeoutManager.dispose(),
            () => stateManager.stateChannelEventListener.dispose(),
            // An abort's log flush, already running: disposal ends the
            // workers only after it (it never fails; each realm reports its
            // own flush failures).
            () => stateManager.abortFlush
        ));
    }

    /**
     * Connects to the chain, syncs the Clock and reads the channel manager's
     * configuration; the Clock and the reads run in parallel. Answers the
     * local EVM's call gas.
     */
    private async readChain(steps: StepTimer): Promise<bigint> {
        const payload = this.payload;
        const logger = this.rootLogger;
        // Provider creation happens before the rest of the runtime graph exists,
        // but its failure must still settle the paired client's `ready` promise.
        this.chainContext = await createRuntimeChainContext(
            payload.config,
            payload.signerSecret,
            logger
        );
        steps.mark("provider");
        const { signer } = this.chainContext;
        const signerAddress = (this.signerAddress = await signer.getAddress());
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

        // Connect the managed signer to the state channel manager contract so every
        // on-chain SCM send draws its nonce from the owned counter.
        let connectedScmContract = connectStateChannelManager(
            payload.scm.address,
            chainSigner,
            JSON.parse(payload.scm.abiJson) as InterfaceAbi
        );
        if (payload.config.DEBUG_CHANNEL_CONTRACT) {
            connectedScmContract = DebugProxy.createProxy(connectedScmContract);
        }
        this.connectedScmContract = connectedScmContract;
        this.stateMachineContract = new ethers.Contract(
            payload.stateMachine.address,
            JSON.parse(payload.stateMachine.abiJson),
            signer
        );

        // Sync clock to DLT while the SCM proxy's configuration is read. A
        // failed read still waits for the sync: the Clock then owns the
        // provider, and disposal leaves it to the Clock instead of destroying
        // it under the sync.
        const [clockSync, reads] = await Promise.allSettled([
            Clock.init(signer.provider!),
            Promise.all([
                connectedScmContract.getAllTimes(),
                connectedScmContract.getGasLimit(),
                connectedScmContract.getStateTransitionReplayGas(),
                connectedScmContract.getMaxChannelParticipants()
            ])
        ]);
        if (clockSync.status === "rejected") throw clockSync.reason;
        if (reads.status === "rejected") throw reads.reason;
        const [
            configTimes,
            disputeExecutionGasLimit,
            stateTransitionReplayGas,
            maxChannelParticipants
        ] = reads.value;
        const timeConfig: TimeConfig = (this.timeConfig = {
            p2pTime: Number(configTimes[0]),
            agreementTime: Number(configTimes[1]),
            chainFallbackTime: Number(configTimes[2]),
            evidenceTime: Number(configTimes[3])
        });
        this.disputeExecutionGasLimit = Number(disputeExecutionGasLimit);
        this.maxChannelParticipants = Number(maxChannelParticipants);
        if (
            !Number.isSafeInteger(this.maxChannelParticipants) ||
            this.maxChannelParticipants < 1
        ) {
            throw new Error(
                "Deployed maximum participant count is not a positive safe integer"
            );
        }
        await LoggerUtils.logTimestamp(logger, "info", timeConfig);
        steps.mark("clockAndChannelManagerReads");
        return localEvmCallGasLimit(
            disputeExecutionGasLimit,
            stateTransitionReplayGas
        );
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
        const steps = new StepTimer(
            () => this.chainContext?.provider.requestCount ?? 0
        );
        const customRpcResolved = await resolveCustomRpcConstructor<
            MainRpcService,
            unknown
        >(payload.customRpcManifest);
        steps.mark("applicationModule");

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
        steps.mark("stateMachine");

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
            // Local-only: consumer custom RPCs parent their child roots here.
            { owner: this },
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
        // a disposal that began during the build missed this runtime: cut
        // and dispose it here (both repeat safely), with any child root its
        // custom RPC created after the children step, and fail the setup
        if (this.isDisposing) {
            this.cutOff();
            await runCleanup(
                () => this.releaseRuntime(),
                () => this.networkClose
            );
            await Promise.allSettled(
                [...this.children].map((child) => child.dispose())
            );
            throw new RootDisposedError("Runtime disposed during setup");
        }
        steps.mark("stateManager");
        await stateManager.p2pManager.localRpc.ready();
        steps.mark("applicationReady");
        steps.log(logger, "Runtime build steps");
    }
}
