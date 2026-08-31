import { ethers, type InterfaceAbi } from "ethers";

import StateManager from "@/stateManager/StateManager";
import EvmDiamondStateMachine from "@/evm/EvmDiamondStateMachine";
import Clock from "@/Clock";
import Storage from "@/storage";
import { TimeConfig } from "@/types";
import type { ForkId, Hash } from "@/types/types";
import {
    createLogger,
    Codec,
    DebugProxy,
    DetachedPromises,
    getErrorPeerAddress,
    Type
} from "@/utils";
import { config, isNodeRuntime } from "@/utils/config";
import { LoggerUtils } from "@/utils/LoggerUtils";
import MainRpcService from "@/rpc/MainRpcService";
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
    deserializeTransactionRequest,
    serializeTransactionResponse
} from "./chainSignerSerialization";
import {
    createRuntimeChainContext,
    type RuntimeChainContext
} from "./RuntimeChainContext";

import type { HostHandlerExecutionContext } from "./HostHandlerExecutionContext";
import type { Logger } from "@/utils/logging/Logger";
import type { LogPortHandle } from "@/utils/logging/logControl";
import { LocalDiscoveryServer } from "@/utils";
import { connectStateChannelManager } from "@/utils/stateChannelManager";
import type {
    HostRpcRequest,
    RuntimeClientMessage,
    RuntimeClientRequest,
    RuntimePort,
    SerializedError,
    SetupPayload
} from "./types";

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
}

/** Live runtime graph while the host is running. */
interface RuntimeHostState {
    stateManager: StateManager;
    evmDiamondStateMachine: EvmDiamondStateMachine;
}

/**
 * Pull a contract revert's ABI-encoded data off an error, checking the same
 * nested shapes `tryDecodeCustomError` reads. Preserving this across the port is
 * what lets the client decode custom errors (the raw `.data` is otherwise lost).
 */
function extractRevertData(error: unknown): string | undefined {
    if (typeof error !== "object" || error === null) return undefined;
    const e = error as {
        data?: unknown;
        error?: { data?: unknown };
        info?: { error?: { data?: unknown } };
        cause?: { data?: unknown };
        originalError?: unknown;
        execResult?: { returnValue?: unknown };
    };
    const candidate =
        e.data ?? e.error?.data ?? e.info?.error?.data ?? e.cause?.data;
    if (typeof candidate === "string") return candidate;
    if (e.originalError !== undefined) {
        const originalErrorData = extractRevertData(e.originalError);
        if (originalErrorData !== undefined) return originalErrorData;
    }
    if (e.execResult?.returnValue !== undefined) {
        try {
            return ethers.hexlify(e.execResult.returnValue as ethers.BytesLike);
        } catch {
            return undefined;
        }
    }
    return undefined;
}

function serializeEthersErrorMetadata(error: Error) {
    // Project ethers' extra error fields into structured-clone-safe values for
    // the client to restore on its local Error instance.
    const ethersError = error as Error & {
        code?: string;
        shortMessage?: string;
        info?: unknown;
        action?: string;
        reason?: string;
        transaction?: unknown;
        receipt?: unknown;
    };
    return {
        code: ethersError.code,
        shortMessage: ethersError.shortMessage,
        info: cloneSerializableErrorField(ethersError.info),
        action: ethersError.action,
        reason: ethersError.reason,
        transaction: cloneSerializableErrorField(ethersError.transaction),
        receipt: cloneSerializableErrorField(ethersError.receipt)
    };
}

export function serializeError(error: unknown): SerializedError {
    if (error instanceof Error) {
        return {
            message: error.message,
            name: error.name,
            stack: error.stack,
            data: extractRevertData(error),
            ...serializeEthersErrorMetadata(error),
            peerAddress: getErrorPeerAddress(error)
        };
    }
    return {
        message: String(error),
        data: extractRevertData(error),
        peerAddress: getErrorPeerAddress(error)
    };
}

function cloneSerializableErrorField(value: unknown): unknown {
    if (value === undefined) return undefined;
    let candidate = value;
    if (
        typeof value === "object" &&
        value !== null &&
        "toJSON" in value &&
        typeof value.toJSON === "function"
    ) {
        candidate = value.toJSON();
    }
    try {
        return globalThis.structuredClone(candidate);
    } catch {
        return undefined;
    }
}

/**
 * In a worker that can't run WebRTC itself, mint the bridge channel, hand the
 * main-thread end to the client (transferred) so it surfaces on
 * `P2pInstance.webRTCBridgePort`, then register the worker end. Returns that
 * worker-end port (for teardown) or `undefined` when no bridge was set up.
 */
async function bubbleWebRTCBridgePortIfNeeded(
    port: RuntimePort
): Promise<MessagePort | undefined> {
    if (!(await doesWorkerNeedMainThreadBridge())) return undefined;
    // The bridge speaks the DOM MessagePort API; in a worker the global
    // MessageChannel works on both web and Node (worker_threads-backed) and its
    // ports transfer over the runtime port.
    const bridge = new MessageChannel();
    // Transfer the main-thread end first: if the post fails we never register a
    // half-installed bridge whose worker end has no paired broker.
    port.post({ type: "webRTCBridgePort", port: bridge.port2 }, [bridge.port2]);
    WorkerBridgeWebRTCConnectionFactory.getInstance().registerPort(
        bridge.port1
    );
    return bridge.port1;
}

/**
 * Construct the live p2p runtime graph and drive it from a {@link RuntimePort}.
 *
 * Requests arriving on the port are dispatched to the state manager / internal
 * signer; p2p event hooks and contract events are forwarded back to the client.
 * Emits a `ready` message once fully constructed.
 */
export async function startP2pRuntimeHost<
    TCustomRpc extends MainRpcService = MainRpcService,
    TCustomRpcOptions = unknown
>(port: RuntimePort, payload: SetupPayload, ctx: HostContext): Promise<void> {
    const runtimeStartedAt = Date.now();
    const { threadLabel, handlerExecutionContext } = ctx;
    let chainContext: RuntimeChainContext;
    try {
        chainContext = await createRuntimeChainContext(
            payload.config,
            payload.signerSecret
        );
    } catch (error) {
        // Provider creation happens before the rest of the runtime graph exists,
        // but its failure must still settle the paired client's `ready` promise.
        port.post({ type: "hostError", error: serializeError(error) });
        port.close();
        throw error;
    }
    const { provider, signer } = chainContext;
    let logger: Logger | undefined;
    let contractExecutor: AContractExecutor | undefined;
    let runtimeHandle: RuntimeHostState | undefined;
    let bridgeWorkerPort: MessagePort | undefined;
    let hostLogHandle: LogPortHandle | undefined;
    let removeLogWiring: (() => void) | undefined;
    let disposed = false;

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
                if (!Clock.ownsProvider(provider)) await provider.destroy();
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

    try {
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

        // threadLabel is set only by startP2pRuntimeWorker -> host is threaded
        if (threadLabel) {
            hostLogHandle = logger.addLogPort({
                post: (message) => port.post({ type: "logControl", message }),
                remoteRealm: "parent"
            });
            removeLogWiring = () => hostLogHandle?.remove();
        } else if (ctx.contextFollower) {
            removeLogWiring = logger.followContextTo(ctx.contextFollower);
        }

        // Own this account's nonce so the peer's concurrent async flows can't collide
        // on it (the REPLACEMENT_UNDERPRICED race). Used only for the real-chain SCM
        // send + retry paths below; the local-VM signers (deploy/executor, p2p) and
        // the read-only Clock stay on the raw signer.
        const chainSigner = new HostNonceManager(signer, logger);

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
        const deploySigner = new LocalContractExecutorSigner(
            signer,
            contractExecutor
        );

        const buildRuntime = async (
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
                    signer,
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
                logger!,
                customRpcResolved?.customRpc,
                customRpcResolved?.customRpcOptions
            );

            evmDiamondStateMachine.setStateManager(stateManager);

            // The single port bridge: every bus emission crosses as one
            // uniform payload. It runs after all local listeners; a clone
            // failure propagates to the producer (posting after close is a
            // silent drop on Node -- remote closure is handled by onClose).
            stateManager.events.setBridgeTap((kind, eventName, args) =>
                port.post({ type: "busEvent", kind, eventName, args })
            );

            forwardEventHandlerInvocations(
                stateManager.eventHandler,
                stateManager.events,
                handlerExecutionContext
            );

            if (handlerExecutionContext) {
                const p2pManager = stateManager.p2pManager;
                const onRpc = p2pManager.onRpc.bind(p2pManager);
                p2pManager.onRpc = (serializedRpc, transport) =>
                    handlerExecutionContext.runHandler(() =>
                        onRpc(serializedRpc, transport)
                    );
            }

            runtimeHandle = { stateManager, evmDiamondStateMachine };
            await stateManager.p2pManager.localRpc.ready();
            // A bridge-setup failure must not deadlock `ready`; WebRTC is optional.
            try {
                bridgeWorkerPort = await bubbleWebRTCBridgePortIfNeeded(port);
            } catch (error) {
                logger!.error(
                    "WebRTC bridge setup failed; continuing without it",
                    {
                        error
                    }
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
                logger!.startPerformanceMonitoring({ threadLabel });
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
            port.post({ type: "ready" });
        };

        const handleRequest = async (
            request: RuntimeClientRequest
        ): Promise<void> => {
            const shouldCloseAfterResponse = request.type === "dispose";
            try {
                let result: unknown;
                switch (request.type) {
                    case "chainSignerSignTransaction":
                        result = await chainSigner.signTransaction(
                            deserializeTransactionRequest(
                                request.serializedTransaction
                            )
                        );
                        break;
                    case "chainSignerSendTransaction": {
                        const response = await chainSigner.sendTransaction(
                            deserializeTransactionRequest(
                                request.serializedTransaction
                            )
                        );
                        result = serializeTransactionResponse(response);
                        break;
                    }
                    case "chainSignerSignMessage":
                        result = await chainSigner.signMessage(
                            request.message.kind === "string"
                                ? request.message.value
                                : ethers.getBytes(request.message.encodedBytes)
                        );
                        break;
                    case "chainSignerSignTypedData":
                        result = await chainSigner.signTypedData(
                            request.domain as ethers.TypedDataDomain,
                            request.types as Record<
                                string,
                                ethers.TypedDataField[]
                            >,
                            request.value as Record<string, any>
                        );
                        break;
                    case "deploySignerGetAddress":
                        result = await deploySigner.getAddress();
                        break;
                    case "deploySignerGetNonce":
                        result = await deploySigner.getNonce();
                        break;
                    case "deploySignerResolveName":
                        result = await deploySigner.resolveName(request.name);
                        break;
                    case "deploySignerCall":
                        result = await deploySigner.call(
                            request.tx as ethers.TransactionRequest
                        );
                        break;
                    case "deploySignerSendTransaction": {
                        const deployTx = await deploySigner.sendTransaction(
                            request.tx as ethers.TransactionRequest
                        );
                        result = {
                            hash: deployTx.hash,
                            to: deployTx.to,
                            from: deployTx.from,
                            data: (deployTx as any).data,
                            receipt: await deployTx.wait()
                        };
                        break;
                    }
                    case "deployComplete":
                        await buildRuntime(
                            request.localStateMachineAddress,
                            request.diamondStateMachineAddress
                        );
                        break;
                    case "sendTransaction":
                        if (!runtimeHandle)
                            throw new Error("Runtime is not ready");
                        await runtimeHandle.stateManager.p2pManager.p2pSigner.sendTransaction(
                            { data: request.data }
                        );
                        break;
                    case "callView":
                        if (!runtimeHandle)
                            throw new Error("Runtime is not ready");
                        result =
                            await runtimeHandle.stateManager.p2pManager.p2pSigner.call(
                                { data: request.data }
                            );
                        break;
                    case "connectToChannel":
                        if (!runtimeHandle)
                            throw new Error("Runtime is not ready");
                        await runtimeHandle.stateManager.p2pManager.p2pSigner.connectToChannel(
                            request.channelId
                        );
                        break;
                    case "joinChannel":
                        if (!runtimeHandle)
                            throw new Error("Runtime is not ready");
                        await runtimeHandle.stateManager.p2pManager.p2pSigner.joinChannel(
                            Codec.decode(
                                request.encodedJoinChannelConfirmation,
                                Type.JoinChannelConfirmation
                            ),
                            request.expectedSnapshotHash as Hash,
                            request.expectedForkId as ForkId
                        );
                        break;
                    case "topUpBalance":
                        if (!runtimeHandle)
                            throw new Error("Runtime is not ready");
                        await runtimeHandle.stateManager.p2pManager.p2pSigner.topUpBalance(
                            Codec.decode(
                                request.encodedJoinChannelConfirmation,
                                Type.JoinChannelConfirmation
                            ),
                            request.expectedSnapshotHash as Hash,
                            request.expectedForkId as ForkId
                        );
                        break;
                    case "collectJoinChannelConfirmation": {
                        if (!runtimeHandle)
                            throw new Error("Runtime is not ready");
                        const prepared =
                            await runtimeHandle.stateManager.p2pManager.p2pSigner.collectJoinChannelConfirmation(
                                Codec.decode(
                                    request.encodedJoinChannel,
                                    Type.JoinChannel
                                )
                            );
                        result = {
                            encodedJoinChannelConfirmation: Codec.encode(
                                prepared.confirmation,
                                Type.JoinChannelConfirmation
                            ),
                            expectedSnapshotHash: prepared.expectedSnapshotHash,
                            expectedForkId: prepared.expectedForkId
                        };
                        break;
                    }
                    case "setChannelId":
                        if (!runtimeHandle)
                            throw new Error("Runtime is not ready");
                        await runtimeHandle.stateManager.p2pManager.p2pSigner.setChannelId(
                            request.channelId
                        );
                        break;
                    case "getChannelStatus":
                        if (!runtimeHandle)
                            throw new Error("Runtime is not ready");
                        result =
                            await runtimeHandle.stateManager.p2pManager.p2pSigner.getChannelStatus();
                        break;
                    case "setIsLeader":
                        if (!runtimeHandle)
                            throw new Error("Runtime is not ready");
                        runtimeHandle.stateManager.p2pManager.p2pSigner.setIsLeader(
                            request.value
                        );
                        break;
                    case "disconnectFromPeers":
                        if (!runtimeHandle)
                            throw new Error("Runtime is not ready");
                        runtimeHandle.stateManager.p2pManager.p2pSigner.disconnectFromPeers();
                        break;
                    case "hostRpc":
                        if (!runtimeHandle)
                            throw new Error("Runtime is not ready");
                        result = await dispatchHostRpc(
                            runtimeHandle.stateManager.p2pManager,
                            request
                        );
                        break;
                    case "signMessage":
                        result = await signer.signMessage(request.message);
                        break;
                    case "signTypedData":
                        result = await signer.signTypedData(
                            request.domain as never,
                            request.types as never,
                            request.value as never
                        );
                        break;
                    case "quiesce": {
                        // Drain this host realm's detached promises and report the
                        // ones that rejected, so the orchestrator can settle and
                        // surface host-side async work over the port.
                        // TODO: Separate operation promises from cleanup promises
                        // so disposal can cancel cleanup without a bounded drain.
                        const settled = runtimeHandle?.stateManager.isDisposed
                            ? await DetachedPromises.collectSettledAndClear()
                            : await DetachedPromises.awaitAllAndClear();
                        result = settled
                            .filter((entry) => entry.status === "rejected")
                            .map((entry) =>
                                serializeError(
                                    (entry as PromiseRejectedResult).reason
                                )
                            );
                        break;
                    }
                    case "dispose":
                        await disposeRuntime();
                        break;
                }
                port.post({
                    type: "response",
                    requestId: request.requestId,
                    ok: true,
                    result
                });
            } catch (error) {
                if (request.type === "deployComplete") {
                    try {
                        await disposeRuntime();
                    } catch (cleanupError) {
                        logger?.error("Runtime readiness cleanup failed", {
                            cleanupError
                        });
                    }
                }
                port.post({
                    type: "response",
                    requestId: request.requestId,
                    ok: false,
                    error: serializeError(error)
                });
            }
            if (shouldCloseAfterResponse) {
                port.close();
                await ctx.onDisposed?.();
            }
        };

        const onPortMessage = (raw: unknown): void => {
            const message = raw as RuntimeClientMessage;
            if (message.type === "logControl") {
                // inline host has no port -> handle stays undefined
                hostLogHandle?.receive(message.message);
                return;
            }
            void handleRequest(raw as RuntimeClientRequest);
        };
        port.onMessage(
            handlerExecutionContext
                ? (raw) =>
                      handlerExecutionContext.runHandler(() =>
                          onPortMessage(raw)
                      )
                : onPortMessage
        );
        // Client went away without a clean `dispose` (thread died / port closed).
        port.onClose(() => {
            void disposeRuntime().catch((error) => {
                logger!.error("Runtime dispose on client close failed", {
                    error
                });
            });
        });
        port.start();
    } catch (error) {
        try {
            await disposeRuntime();
        } catch (cleanupError) {
            logger?.error("Runtime startup cleanup failed", { cleanupError });
        }
        try {
            port.post({ type: "hostError", error: serializeError(error) });
        } catch (postError) {
            logger?.error("Runtime startup error delivery failed", {
                postError
            });
        }
        port.close();
        throw error;
    }
}

/**
 * Replays a `hostRpc.<service>.<method>(...params).<delivery>(...args)` call
 * mirrored from the client onto the host's live `remoteRpc` and awaits the
 * result. The port is a pure proxy; all target semantics (omitted target =
 * loopback to self, peer address = relay) are handled by the RPC handler.
 */
async function dispatchHostRpc(
    p2pManager: StateManager["p2pManager"],
    request: HostRpcRequest
): Promise<unknown> {
    const service = (p2pManager.remoteRpc as any)[request.service];
    return await service[request.method](...request.params)[request.delivery](
        ...request.args
    );
}
