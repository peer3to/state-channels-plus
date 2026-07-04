import { Signer, ethers } from "ethers";
import {
    StateChannelManagerProxy,
    AStateMachine as AStateMachineContract
} from "@typechain-types";
import { JoinChannelConfirmationStruct } from "@typechain-types/contracts/V1/types/DataTypes";

import StateManager from "@/stateManager/StateManager";
import EvmDiamondStateMachine from "@/evm/EvmDiamondStateMachine";
import Clock from "@/Clock";
import Storage from "@/storage";
import { TimeConfig } from "@/types";
import { createLogger, DebugProxy, DetachedPromises } from "@/utils";
import { config } from "@/utils/config";
import { LoggerUtils } from "@/utils/LoggerUtils";
import MainRpcService from "@/rpc/MainRpcService";
import { resolveCustomRpcConstructor } from "@/rpc/resolveCustomRpcManifest";
import LocalContractExecutorSigner from "@/evm/signer/LocalContractExecutorSigner";
import ManagedNonceSigner from "@/evm/signer/ManagedNonceSigner";
import { createContractExecutorFactory } from "@/evm/contractExecutor";
import WorkerBridgeWebRTCConnectionFactory from "@/rpc/services/WebRTCSetup/connection/WorkerBridgeWebRTCConnectionFactory";
import { doesWorkerNeedMainThreadBridge } from "@/rpc/services/WebRTCSetup/connection/WebRTCProvider";
import {
    createForwardingHooks,
    forwardEventHandlerInvocations
} from "./host/EventForwarding";

import type {
    HostRpcRequest,
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
    signer: Signer;
    /**
     * When set, this host runs in its own worker thread; the label (e.g. "sdk")
     * tags this thread's event-loop-delay diagnostic reports. Unset for the
     * inline (main-thread) host — the harness's main logger covers that.
     */
    threadLabel?: string;
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
        execResult?: { returnValue?: unknown };
    };
    const candidate =
        e.data ?? e.error?.data ?? e.info?.error?.data ?? e.cause?.data;
    if (typeof candidate === "string") return candidate;
    if (e.execResult?.returnValue !== undefined) {
        try {
            return ethers.hexlify(e.execResult.returnValue as ethers.BytesLike);
        } catch {
            return undefined;
        }
    }
    return undefined;
}

export function serializeError(error: unknown): SerializedError {
    if (error instanceof Error) {
        return {
            message: error.message,
            name: error.name,
            stack: error.stack,
            data: extractRevertData(error)
        };
    }
    return { message: String(error), data: extractRevertData(error) };
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
    const { signer, threadLabel } = ctx;
    const signerAddress = await signer.getAddress();
    const logger = createLogger(
        { peerId: payload.peerId, peerAddress: signerAddress },
        { component: "P2pRuntimeHost" },
        { attachErrorListener: false }
    );

    // When this host runs in its own worker thread (sdk-in-thread), monitor that
    // thread's event loop with the standard logger monitor — same
    // EVENT_LOOP_DELAY_ERROR_THRESHOLD_SECONDS guard (throws past it) as every
    // other thread. threadLabel tags its ##E2E_TIMING## delay-peak reports.
    if (config.EVENT_LOOP_DELAY_ERROR_THRESHOLD_SECONDS > 0 && threadLabel) {
        logger.startPerformanceMonitoring({ threadLabel });
    }

    // Own this account's nonce so the peer's concurrent async flows can't collide
    // on it (the REPLACEMENT_UNDERPRICED race). Used only for the real-chain SCM
    // send + retry paths below; the local-VM signers (deploy/executor, p2p) and
    // the read-only Clock stay on the raw signer.
    const chainSigner = new ManagedNonceSigner(signer, logger);

    const scmContract = new ethers.Contract(
        payload.scm.address,
        JSON.parse(payload.scm.abiJson),
        signer
    ) as unknown as StateChannelManagerProxy;
    const stateMachineContract = new ethers.Contract(
        payload.stateMachine.address,
        JSON.parse(payload.stateMachine.abiJson),
        signer
    );

    // Sync clock to DLT.
    await Clock.init(signer.provider!);

    // Connect the managed signer to the state channel manager contract so every
    // on-chain SCM send draws its nonce from the owned counter.
    let connectedScmContract = (await scmContract.connect(
        chainSigner
    )) as StateChannelManagerProxy;
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

    const contractExecutor = await createContractExecutorFactory({
        dedicatedThread: payload.config.VM_DEDICATED_THREAD,
        customPrecompiles: payload.customPrecompiles,
        logger
    });
    const deploySigner = new LocalContractExecutorSigner(
        signer,
        contractExecutor
    );

    let runtimeHandle: RuntimeHostState | undefined;
    let disposed = false;
    let bridgeWorkerPort: MessagePort | undefined;

    // Idempotent: the `dispose` request and the port-close handler both call it.
    const disposeRuntime = async (): Promise<void> => {
        if (disposed) return;
        disposed = true;
        if (bridgeWorkerPort) {
            WorkerBridgeWebRTCConnectionFactory.getInstance().disposeBridge(
                bridgeWorkerPort
            );
        }
        if (runtimeHandle) {
            await runtimeHandle.stateManager.dispose();
        } else {
            await contractExecutor.dispose();
        }
    };

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
                contractExecutor,
                localStateMachineAddress,
                diamondStateMachineAddress,
                stateMachineContract.interface,
                signer,
                timeConfig,
                disputeExecutionGasLimit
            );

        const storage = new Storage();

        const stateManager = new StateManager<TCustomRpc, TCustomRpcOptions>(
            // Managed signer: becomes StateManager.signer → DisputeManager.signer,
            // covering the raw evmErrorHandler retry send so it can't bypass the
            // owned nonce counter and re-open the race.
            chainSigner,
            signerAddress,
            connectedScmContract,
            evmDiamondStateMachine,
            timeConfig,
            createForwardingHooks(port),
            storage,
            logger,
            customRpcResolved?.customRpc,
            customRpcResolved?.customRpcOptions
        );

        evmDiamondStateMachine.setStateManager(stateManager);

        const p2pContractInstance = stateMachineContract.connect(
            stateManager.p2pManager.p2pSigner
        ) as unknown as AStateMachineContract;
        evmDiamondStateMachine.setP2pContractInstance(p2pContractInstance);

        evmDiamondStateMachine.setContractEventEmitter((name, args) =>
            port.post({ type: "contractEvent", name, args })
        );

        forwardEventHandlerInvocations(stateManager.eventHandler, port);

        runtimeHandle = { stateManager, evmDiamondStateMachine };
        // A bridge-setup failure must not deadlock `ready`; WebRTC is optional.
        try {
            bridgeWorkerPort = await bubbleWebRTCBridgePortIfNeeded(port);
        } catch (error) {
            logger.error("WebRTC bridge setup failed; continuing without it", {
                error
            });
        }
        port.post({ type: "ready" });
    };

    const handleRequest = async (
        request: RuntimeClientRequest
    ): Promise<void> => {
        try {
            let result: unknown;
            switch (request.type) {
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
                case "deploySignerSendTransaction":
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
                case "deployComplete":
                    await buildRuntime(
                        request.localStateMachineAddress,
                        request.diamondStateMachineAddress
                    );
                    break;
                case "sendTransaction":
                    if (!runtimeHandle) throw new Error("Runtime is not ready");
                    await runtimeHandle.stateManager.p2pManager.p2pSigner.sendTransaction(
                        { data: request.data }
                    );
                    break;
                case "callView":
                    if (!runtimeHandle) throw new Error("Runtime is not ready");
                    result =
                        await runtimeHandle.stateManager.p2pManager.p2pSigner.call(
                            { data: request.data }
                        );
                    break;
                case "connectToChannel":
                    if (!runtimeHandle) throw new Error("Runtime is not ready");
                    await runtimeHandle.stateManager.p2pManager.p2pSigner.connectToChannel(
                        request.channelId
                    );
                    break;
                case "joinChannel":
                    if (!runtimeHandle) throw new Error("Runtime is not ready");
                    await runtimeHandle.stateManager.p2pManager.p2pSigner.joinChannel(
                        request.confirmation as JoinChannelConfirmationStruct
                    );
                    break;
                case "setChannelId":
                    if (!runtimeHandle) throw new Error("Runtime is not ready");
                    await runtimeHandle.stateManager.p2pManager.p2pSigner.setChannelId(
                        request.channelId
                    );
                    break;
                case "getChannelStatus":
                    if (!runtimeHandle) throw new Error("Runtime is not ready");
                    result =
                        await runtimeHandle.stateManager.p2pManager.p2pSigner.getChannelStatus();
                    break;
                case "setIsLeader":
                    if (!runtimeHandle) throw new Error("Runtime is not ready");
                    runtimeHandle.stateManager.p2pManager.p2pSigner.setIsLeader(
                        request.value
                    );
                    break;
                case "disconnectFromPeers":
                    if (!runtimeHandle) throw new Error("Runtime is not ready");
                    runtimeHandle.stateManager.p2pManager.p2pSigner.disconnectFromPeers();
                    break;
                case "hostRpc":
                    if (!runtimeHandle) throw new Error("Runtime is not ready");
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
                    const settled = await DetachedPromises.awaitAllAndClear();
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
            port.post({
                type: "response",
                requestId: request.requestId,
                ok: false,
                error: serializeError(error)
            });
        }
    };

    port.onMessage((raw) => {
        void handleRequest(raw as RuntimeClientRequest);
    });
    // Client went away without a clean `dispose` (thread died / port closed).
    port.onClose(() => {
        void disposeRuntime().catch((error) => {
            logger.error("Runtime dispose on client close failed", { error });
        });
    });
    port.start();
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
