import type { EvmCustomPrecompileManifest } from "../EvmFactory";
import P2pInstance from "../P2pInstance";
import type { HostHandlerExecutionContext } from "./HostHandlerExecutionContext";
import P2pRuntimeClient from "./P2pRuntimeClient";
import { startP2pRuntimeHost, type HostContext } from "./P2pRuntimeHost";
import type {
    P2pRuntimeWorker,
    RuntimePort,
    SerializedContract,
    SetupPayload,
    WorkerBootstrapMessage
} from "./types";
import DeploymentBridgeSigner from "../signer/DeploymentBridgeSigner";
import type MainRpcService from "@/rpc/MainRpcService";
import type { CustomRpcManifest } from "@/rpc/registry";
import { createLogger, Logger } from "@/utils";
import { createConfig, Config } from "@/utils/config";
import {
    createRuntimeChannel,
    createTransferableChannel
} from "@platform/p2pRuntimeChannel";
import { createP2pRuntimeWorker as createProductionP2pRuntimeWorker } from "@platform/p2pRuntimeWorkerRuntime";
import type {
    StateChannelManagerInterface,
    AStateMachine as AStateMachineContract
} from "@typechain-types";
import { ethers } from "ethers";
import type { LocalStateMachineDeployer } from "scripts/V1/deploy";

/** Public options of `EvmStateMachine.p2pSetup`, unchanged. */
export type P2pSetupOptions = {
    peerId?: number;
    peerLogger?: Logger;
    customRpcManifest?: CustomRpcManifest;
    /**
     * Runtime configuration. PROVIDER_URL must expose WebSocket RPC on
     * the same authority; http(s) URLs are converted to ws(s).
     */
    config?: Partial<Config>;
    customPrecompiles?: EvmCustomPrecompileManifest[];
    /**
     * Signer secret (private key or mnemonic) owned by the runtime host.
     * Injected signers are intentionally unsupported; a random private
     * key is generated when omitted.
     */
    signerSecret?: string;
    /**
     * Context every inline-host handler runs inside (see
     * {@link HostHandlerExecutionContext}). Ignored in threaded mode —
     * a worker thread runs exactly one peer's host.
     */
    handlerExecutionContext?: HostHandlerExecutionContext;
};

/**
 * Internal construction dependencies, not part of the package API. The inline
 * host is started with `hostContext`; the threaded host is spawned through
 * `createP2pRuntimeWorker`. Tests supply a host context that builds a scripted
 * contract-executor worker and an outer test-worker factory; production
 * passes neither and gets the platform defaults.
 */
export type P2pSetupDependencies = {
    hostContext?: Pick<HostContext, "createContractExecutor">;
    createP2pRuntimeWorker?: () => P2pRuntimeWorker;
};

/**
 * The runtime construction behind `EvmStateMachine.p2pSetup`: config, the
 * serializable payload, the inline or threaded host, the client, the two local
 * state machine deployments, and readiness. `p2pSetup` is a wrapper that
 * passes the production dependencies.
 */
export async function setupP2pRuntime<
    T extends AStateMachineContract,
    TCustomRpc extends MainRpcService = MainRpcService
>(
    deployedStateChannelContractInstance: StateChannelManagerInterface,
    stateMachineContractInstance: T,
    deployStateMachine: LocalStateMachineDeployer,
    options: P2pSetupOptions | undefined,
    dependencies: P2pSetupDependencies = {}
): Promise<P2pInstance<T, TCustomRpc>> {
    // Initialize SDK config for this runtime (intended to be called once).
    const activeConfig = createConfig(options?.config);

    const runtimeSignerSecret =
        options?.signerSecret ?? ethers.Wallet.createRandom().privateKey;
    const trimmedSignerSecret = runtimeSignerSecret.trim();
    const resolvedSignerAddress = /^0x[0-9a-fA-F]{64}$/.test(
        trimmedSignerSecret
    )
        ? new ethers.Wallet(trimmedSignerSecret).address
        : ethers.Wallet.fromPhrase(trimmedSignerSecret).address;

    // a caller-supplied logger stays the caller's to dispose; one made here
    // is registered on this realm's bus and owns process crash hooks, so the
    // instance has to give it back
    const ownsLogger = !options?.peerLogger;

    const logger =
        options?.peerLogger ||
        createLogger(
            { peerId: options?.peerId, peerAddress: resolvedSignerAddress },
            { component: "ClientApp" },
            { attachErrorListener: true }
        );

    // a setup that never returns an instance has nobody to hand the
    // logger to: dispose it here or it stays on the realm bus forever
    try {
        // Main-thread description of the app contract (rebuilt by the client).
        const stateMachine: SerializedContract = {
            address: (
                await stateMachineContractInstance.getAddress()
            ).toString(),
            abiJson: stateMachineContractInstance.interface.formatJson()
        };

        const scm: SerializedContract = {
            address: (
                await deployedStateChannelContractInstance.getAddress()
            ).toString(),
            abiJson: deployedStateChannelContractInstance.interface.formatJson()
        };
        const clientProvider =
            deployedStateChannelContractInstance.runner?.provider;
        if (!clientProvider) {
            throw new Error(
                "p2pSetup requires the state channel manager to have a provider"
            );
        }

        const payload: SetupPayload = {
            config: activeConfig,
            scm,
            stateMachine,
            signerSecret: runtimeSignerSecret,
            peerId: options?.peerId,
            customRpcManifest: options?.customRpcManifest,
            customPrecompiles: options?.customPrecompiles
        };

        let clientPort: RuntimePort;
        let onClose: (() => void) | undefined;
        let webRTCBridgeCandidate: MessagePort | undefined;

        if (activeConfig.RUN_SDK_IN_THREAD) {
            const { localPort, transferablePort } = createTransferableChannel();
            // the bridge is minted here and its worker end goes down with
            // the bootstrap: an RPC frame cannot transfer a port
            const bridge = new MessageChannel();
            webRTCBridgeCandidate = bridge.port1;
            const worker = (
                dependencies.createP2pRuntimeWorker ??
                createProductionP2pRuntimeWorker
            )();
            const bootstrap: WorkerBootstrapMessage = {
                type: "connect",
                payload,
                port: transferablePort,
                webRTCBridgePort: bridge.port2
            };
            worker.postMessage(bootstrap, [transferablePort, bridge.port2]);
            clientPort = localPort;
            onClose = () => worker.shutdown();
        } else {
            const channel = createRuntimeChannel();
            clientPort = channel.port1;
            void startP2pRuntimeHost(channel.port2, payload, {
                handlerExecutionContext: options?.handlerExecutionContext,
                createContractExecutor:
                    dependencies.hostContext?.createContractExecutor,
                // same realm, no port -> the app's logger follows the host's channel
                contextFollower: logger
            }).catch((error) => {
                logger.error("Inline runtime host failed", { error });
            });
        }

        const client = new P2pRuntimeClient<T>(clientPort, {
            signerAddress: resolvedSignerAddress,
            stateMachine,
            scm,
            provider: clientProvider,
            logger,
            onClose,
            // only a threaded host is a separate realm with its own bus
            openLogControlPort: activeConfig.RUN_SDK_IN_THREAD,
            webRTCBridgeCandidate
        });

        const deployBridgeSigner = new DeploymentBridgeSigner(
            client.host,
            resolvedSignerAddress
        );
        // Deploy two independent local state machine instances:
        //  - one drives the replicated channel state (EvmDiamondStateMachine)
        //  - one is embedded in the LocalDiamond for dispute execution
        // They must be separate so dispute replay never clobbers live state.
        const localStateMachineAddress =
            await deployStateMachine(deployBridgeSigner);
        const diamondStateMachineAddress =
            await deployStateMachine(deployBridgeSigner);
        try {
            await client.deployComplete(
                localStateMachineAddress.toString(),
                diamondStateMachineAddress.toString()
            );
            await client.ready;
        } catch (error) {
            await client.dispose();
            throw error;
        }

        const p2pInstance = new P2pInstance<T, TCustomRpc>(
            client,
            logger,
            ownsLogger
        );
        // On the main thread the surfaced WebRTC bridge port has no further
        // worker nesting to bubble up to, so wire it to the local
        // RTCPeerConnection here; inside a worker it stays on
        // p2pInstance.webRTCBridgePort for the consumer app to bubble up.
        p2pInstance.installMainThreadBridgeIfOnMainThread();
        return p2pInstance;
    } catch (error) {
        if (ownsLogger) logger.dispose();
        throw error;
    }
}
