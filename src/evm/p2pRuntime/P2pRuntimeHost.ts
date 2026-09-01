import { ethers, type InterfaceAbi } from "ethers";

import StateManager from "@/stateManager/StateManager";
import EvmDiamondStateMachine from "@/evm/EvmDiamondStateMachine";
import Clock from "@/Clock";
import Storage from "@/storage";
import { TimeConfig } from "@/types";
import { createLogger, DebugProxy, DetachedPromises } from "@/utils";
import { config, isNodeRuntime } from "@/utils/config";
import { LoggerUtils } from "@/utils/LoggerUtils";
import MainRpcService from "@/rpc/MainRpcService";
import PortRpcRouter from "@/rpc/PortRpcRouter";
import { serializeError, type SerializedError } from "@/rpc/serializeError";
import { resolveCustomRpcConstructor } from "@/rpc/resolveCustomRpcManifest";
import LocalContractExecutorSigner from "@/evm/signer/LocalContractExecutorSigner";
import HostNonceManager from "@/evm/signer/HostNonceManager";
import {
    AContractExecutor,
    createContractExecutorFactory
} from "@/evm/contractExecutor";
import WorkerBridgeWebRTCConnectionFactory from "@/rpc/services/WebRTCSetup/connection/WorkerBridgeWebRTCConnectionFactory";
import { doesWorkerNeedMainThreadBridge } from "@/rpc/services/WebRTCSetup/connection/WebRTCProvider";
import { forwardEventHandlerInvocations } from "./host/EventForwarding";
import {
    createRuntimeChainContext,
    type RuntimeChainContext
} from "./RuntimeChainContext";
import {
    P2P_RUNTIME_CLIENT_MANIFEST,
    type P2pRuntimeClientRoot
} from "./rpc/P2pRuntimeClientRoot";
import {
    P2pRuntimeHostRoot,
    type RuntimeHandle,
    type RuntimeHost
} from "./rpc/P2pRuntimeHostRoot";

import type { HostHandlerExecutionContext } from "./HostHandlerExecutionContext";
import type { Logger } from "@/utils/logging/Logger";
import type ATransport from "@/transport/ATransport";
import { LocalDiscoveryServer } from "@/utils";
import { connectStateChannelManager } from "@/utils/stateChannelManager";
import type { RuntimePort, SetupPayload } from "./types";

export { serializeError };

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
     * Optional context this host's handlers run inside (see
     * {@link HostHandlerExecutionContext}). Unused in threaded mode — a worker
     * thread runs exactly one peer's host, so no disambiguation is needed.
     */
    handlerExecutionContext?: HostHandlerExecutionContext;
    /** Release worker-only bootstrap resources after replying to dispose. */
    onDisposed?: () => void | Promise<void>;
    /** logger in this realm whose channel follows this host's. inline only - with
     *  no port there is nothing to carry the context. */
    contextFollower?: Logger;
    /**
     * the worker end of the WebRTC bridge channel, transferred with the
     * bootstrap. registered when this worker cannot negotiate WebRTC itself,
     * closed otherwise. threaded only.
     */
    webRTCBridgePort?: MessagePort;
    /** hook this thread's unhandled errors, so they reach the client as
     *  hostError casts. threaded only. */
    onUnhandledError?: (handler: (error: unknown) => void) => void;
}

/** the "Runtime is not ready" accessor over a piece that exists only later */
function required<T>(value: T | undefined, what: string): T {
    if (value === undefined) throw new Error(`Runtime is not ready: ${what}`);
    return value;
}

/**
 * Construct the live p2p runtime graph and drive it from a {@link RuntimePort}.
 *
 * Requests arriving on the port are dispatched to the state manager / internal
 * signer; p2p event hooks and contract events are forwarded back to the client.
 * The reply to `lifecycle.deployComplete` is the readiness signal.
 */
export async function startP2pRuntimeHost<
    TCustomRpc extends MainRpcService = MainRpcService,
    TCustomRpcOptions = unknown
>(port: RuntimePort, payload: SetupPayload, ctx: HostContext): Promise<void> {
    const runtimeStartedAt = Date.now();
    const { threadLabel, handlerExecutionContext } = ctx;

    // the pieces the services reach, filled in as they are built
    let logger: Logger | undefined;
    let signer: ethers.Signer | undefined;
    let chainSigner: HostNonceManager | undefined;
    let deploySigner: LocalContractExecutorSigner | undefined;
    let contractExecutor: AContractExecutor | undefined;
    let runtimeHandle: RuntimeHandle | undefined;
    let bridgeWorkerPort: MessagePort | undefined;
    let removeLogWiring: (() => void) | undefined;
    let disposed = false;
    let buildRuntime:
        | ((
              localStateMachineAddress: string,
              diamondStateMachineAddress: string
          ) => Promise<{ webRTCBridge: boolean }>)
        | undefined;

    const disposeRuntime = async (): Promise<void> => {
        if (disposed) return;
        disposed = true;
        try {
            if (bridgeWorkerPort) {
                WorkerBridgeWebRTCConnectionFactory.getInstance().disposeBridge(
                    bridgeWorkerPort
                );
            }
            if (runtimeHandle) {
                await runtimeHandle.stateManager.dispose();
            } else {
                await contractExecutor?.dispose();
            }
        } finally {
            try {
                // Destroy first so ethers marks the provider closed before its
                // listener cleanup schedules unsubscribe microtasks. Explicitly
                // removing listeners first leaves eth_unsubscribe requests that
                // destroy then rejects as unhandled.
                if (provider && !Clock.ownsProvider(provider)) {
                    await provider.destroy();
                }
                // TODO: Delegate cleanup through the shared Holepunch/local
                // discovery lifecycle API once the backend is injected.
                if (
                    ctx.onDisposed &&
                    config.DEBUG_LOCAL_TRANSPORT &&
                    isNodeRuntime() &&
                    config.LOCAL_DISCOVERY_REGISTRY_URL
                ) {
                    await LocalDiscoveryServer.cleanup();
                }
            } finally {
                // last, but unconditionally: the realm stays reachable by a
                // flush round for the whole teardown, and a throw above must
                // not strand its root on the bus
                removeLogWiring?.();
                removeLogWiring = undefined;
                logger?.dispose();
            }
        }
    };

    const host: RuntimeHost = {
        get logger() {
            return required(logger, "logger");
        },
        get signer() {
            return required(signer, "signer");
        },
        get chainSigner() {
            return required(chainSigner, "chain signer");
        },
        get deploySigner() {
            return required(deploySigner, "deploy signer");
        },
        runtime: () => required(runtimeHandle, "runtime"),
        buildRuntime: (local, diamond) =>
            required(buildRuntime, "deploy signer")(local, diamond),
        disposeRuntime,
        quiesce: async () => {
            // Drain this host realm's detached promises and report the ones
            // that rejected, so the orchestrator can settle and surface
            // host-side async work over the port.
            // TODO: Separate operation promises from cleanup promises so
            // disposal can cancel cleanup without a bounded drain.
            const settled = runtimeHandle?.stateManager.isDisposed
                ? await DetachedPromises.collectSettledAndClear()
                : await DetachedPromises.awaitAllAndClear();
            return settled
                .filter((entry) => entry.status === "rejected")
                .map((entry) =>
                    serializeError((entry as PromiseRejectedResult).reason)
                );
        },
        closeAfterReply: (transport: ATransport) => {
            // the reply is posted in the microtasks after the endpoint
            // returns; the macrotask runs after them
            setTimeout(() => {
                transport.close(true);
                void ctx.onDisposed?.();
            }, 0);
        }
    };

    // the line to the client, up before anything that can fail so a startup
    // error has a way out
    const router = new PortRpcRouter<P2pRuntimeHostRoot>(
        (self) => new P2pRuntimeHostRoot(self, host),
        undefined,
        {
            defaultTimeoutMs: null,
            wrapInbound: handlerExecutionContext
                ? (run) => handlerExecutionContext.runHandler(run)
                : undefined,
            // Client went away without a clean `dispose` (thread died / port
            // closed).
            onClosed: (_transport, isExpected) => {
                if (isExpected) return;
                void disposeRuntime().catch((error) => {
                    logger?.error("Runtime dispose on client close failed", {
                        error
                    });
                });
            }
        }
    );
    // the client deploys through this line while the host is still being
    // built; hold its requests until every service can answer
    router.holdInbound();
    const transport = router.attach(port);
    const client = router.endpoint<P2pRuntimeClientRoot>(
        transport,
        P2P_RUNTIME_CLIENT_MANIFEST
    );
    const reportHostError = (error: unknown) => {
        try {
            client.runtimeEvents.hostError(serializeError(error)).sendOne();
        } catch (postError) {
            logger?.error("Runtime startup error delivery failed", {
                postError
            });
        }
    };
    // Funnel autonomous worker-thread errors to the main-thread orchestrator
    // so they surface as if the host ran inline.
    ctx.onUnhandledError?.(reportHostError);

    let provider: RuntimeChainContext["provider"] | undefined;
    try {
        let chainContext: RuntimeChainContext;
        try {
            chainContext = await createRuntimeChainContext(
                payload.config,
                payload.signerSecret
            );
        } catch (error) {
            // Provider creation happens before the rest of the runtime graph
            // exists, but its failure must still settle the paired client's
            // `ready` promise.
            reportHostError(error);
            transport.close(true);
            throw error;
        }
        provider = chainContext.provider;
        signer = chainContext.signer;

        const signerAddress = await signer.getAddress();
        logger = createLogger(
            {
                peerId: payload.peerId,
                peerAddress: signerAddress,
                threadName: "sdk"
            },
            { component: "P2pRuntimeHost" },
            // inline -> the main realm's logger already has the crash hooks
            { attachErrorListener: Boolean(threadLabel) }
        );
        router.setLogger(logger);

        // threadLabel is set only by startP2pRuntimeWorker -> host is threaded
        if (threadLabel) {
            removeLogWiring = logger.addLogLink({
                id: "main",
                transport,
                router,
                remoteRealm: "parent",
                ownerLogger: logger
            });
        } else if (ctx.contextFollower) {
            removeLogWiring = logger.followContextTo(ctx.contextFollower);
        }

        // Own this account's nonce so the peer's concurrent async flows can't collide
        // on it (the REPLACEMENT_UNDERPRICED race). Used only for the real-chain SCM
        // send + retry paths below; the local-VM signers (deploy/executor, p2p) and
        // the read-only Clock stay on the raw signer.
        chainSigner = new HostNonceManager(signer, logger);

        const scmContract = connectStateChannelManager(
            payload.scm.address,
            chainSigner,
            JSON.parse(payload.scm.abiJson) as InterfaceAbi
        );
        const stateMachineContract = new ethers.Contract(
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
        const timeConfig: TimeConfig = {
            p2pTime: Number(configTimes[0]),
            agreementTime: Number(configTimes[1]),
            chainFallbackTime: Number(configTimes[2]),
            evidenceTime: Number(configTimes[3])
        };
        const disputeExecutionGasLimit = Number(
            await connectedScmContract.getGasLimit()
        );
        await LoggerUtils.logTimestamp(logger, "info", timeConfig);

        contractExecutor = await createContractExecutorFactory({
            dedicatedThread: payload.config.VM_DEDICATED_THREAD,
            customPrecompiles: payload.customPrecompiles,
            logger
        });
        deploySigner = new LocalContractExecutorSigner(
            signer,
            contractExecutor
        );

        const hostSigner = signer;
        const hostChainSigner = chainSigner;
        const hostLogger = logger;
        buildRuntime = async (
            localStateMachineAddress: string,
            diamondStateMachineAddress: string
        ) => {
            const customRpcResolved = await resolveCustomRpcConstructor<
                TCustomRpc,
                TCustomRpcOptions
            >(payload.customRpcManifest as never);

            const { evmDiamondStateMachine } =
                await EvmDiamondStateMachine.createStandaloneFromLocalStateMachineWithExecutor(
                    contractExecutor!,
                    localStateMachineAddress,
                    diamondStateMachineAddress,
                    stateMachineContract.interface,
                    hostSigner,
                    timeConfig,
                    disputeExecutionGasLimit
                );

            const storage = new Storage();

            const stateManager = new StateManager<
                TCustomRpc,
                TCustomRpcOptions
            >(
                // Managed signer: becomes StateManager.signer → DisputeManager.signer,
                // covering the raw evmErrorHandler retry send so it can't bypass the
                // owned nonce counter and re-open the race.
                hostChainSigner,
                signerAddress,
                connectedScmContract,
                evmDiamondStateMachine,
                timeConfig,
                // The app's hooks live on the main thread; the worker realm
                // publishes through the bus and the bridge tap below forwards
                // every event over the port.
                {},
                storage,
                hostLogger,
                customRpcResolved?.customRpc,
                customRpcResolved?.customRpcOptions
            );

            evmDiamondStateMachine.setStateManager(stateManager);

            // The single port bridge: every bus emission crosses as one
            // uniform payload. It runs after all local listeners; a clone
            // failure propagates to the producer (posting after close is a
            // silent drop on Node -- remote closure is handled by onClosed).
            stateManager.events.setBridgeTap((kind, eventName, args) =>
                client.runtimeEvents.busEvent(kind, eventName, args).sendOne()
            );

            forwardEventHandlerInvocations(
                stateManager.eventHandler,
                stateManager.events,
                handlerExecutionContext
            );

            if (handlerExecutionContext) {
                const p2pManager = stateManager.p2pManager;
                const onRpc = p2pManager.onRpc.bind(p2pManager);
                p2pManager.onRpc = (serializedRpc, peerTransport) =>
                    handlerExecutionContext.runHandler(() =>
                        onRpc(serializedRpc, peerTransport)
                    );
            }

            runtimeHandle = { stateManager, evmDiamondStateMachine };
            await stateManager.p2pManager.localRpc.ready();
            // A bridge-setup failure must not deadlock readiness; WebRTC is
            // optional.
            let webRTCBridge = false;
            try {
                bridgeWorkerPort = await registerWebRTCBridgeIfNeeded(
                    ctx.webRTCBridgePort
                );
                webRTCBridge = bridgeWorkerPort !== undefined;
            } catch (error) {
                hostLogger.error(
                    "WebRTC bridge setup failed; continuing without it",
                    { error }
                );
            }
            // When this host runs in its own worker thread (sdk-in-thread), monitor that
            // thread's event loop with the standard logger monitor — same
            // EVENT_LOOP_DELAY_ERROR_THRESHOLD_SECONDS guard (throws past it) as every
            // other thread. threadLabel tags its ##E2E_TIMING## delay-peak reports.
            if (
                config.EVENT_LOOP_DELAY_ERROR_THRESHOLD_SECONDS > 0 &&
                threadLabel
            ) {
                hostLogger.startPerformanceMonitoring({ threadLabel });
            }
            if (
                typeof process !== "undefined" &&
                typeof process.stdout?.write === "function"
            ) {
                process.stdout.write(
                    `##E2E_TIMING## ${JSON.stringify({
                        runtimeReadyMs: Date.now() - runtimeStartedAt,
                        ...(threadLabel ? { runtimeThread: threadLabel } : {})
                    })}\n`
                );
            }
            return { webRTCBridge };
        };
        router.releaseInbound();
    } catch (error) {
        try {
            await disposeRuntime();
        } catch (cleanupError) {
            logger?.error("Runtime startup cleanup failed", { cleanupError });
        }
        reportHostError(error);
        transport.close(true);
        throw error;
    }
}

/**
 * In a worker that can't run WebRTC itself, register the worker end of the
 * bridge channel the main thread transferred with the bootstrap; the client
 * keeps the other end and installs it on `P2pInstance.webRTCBridgePort` once
 * `deployComplete` says the bridge is in use. Returns the registered port, or
 * `undefined` (and closes the port) when no bridge is needed.
 */
async function registerWebRTCBridgeIfNeeded(
    bridgePort: MessagePort | undefined
): Promise<MessagePort | undefined> {
    if (!bridgePort) return undefined;
    if (!(await doesWorkerNeedMainThreadBridge())) {
        bridgePort.close();
        return undefined;
    }
    WorkerBridgeWebRTCConnectionFactory.getInstance().registerPort(bridgePort);
    return bridgePort;
}

export type { SerializedError };
