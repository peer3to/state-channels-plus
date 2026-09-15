import { createHostRpc } from "./ClientHostRpc";
import type { SerializedContract, SetupPayload } from "./types";
import type { EvmCustomPrecompileManifest } from "../EvmFactory";
import P2pInstance from "../P2pInstance";
import type { HostHandlerExecutionContext } from "./HostHandlerExecutionContext";
import ClientChainSigner from "../signer/ClientChainSigner";
import ClientP2pSigner from "../signer/ClientP2pSigner";
import DeploymentBridgeSigner from "../signer/DeploymentBridgeSigner";
import { attachContractEvents } from "@/events/EventBus";
import { createRoot } from "@/rpc/internal/createRoot";
import { P2pRuntimeClientRoot } from "@/rpc/internal/roots/P2pRuntimeClientRoot";
import type { HostContext } from "@/rpc/internal/roots/P2pRuntimeHostRoot";
import type MainRpcService from "@/rpc/network/MainRpcService";
import type { CustomRpcManifest } from "@/rpc/network/registry";
import { createLogger } from "@/utils";
import type { Logger } from "@/utils";
import { createConfig } from "@/utils/config";
import type { Config } from "@/utils/config";
import { connectStateChannelManager } from "@/utils/stateChannelManager";
import type {
    StateChannelManagerInterface,
    AStateMachine as AStateMachineContract
} from "@typechain-types";
import { ethers, type InterfaceAbi } from "ethers";
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
 * host is started with `hostContext`; worker placement uses `createRoot`.
 */
export type P2pSetupDependencies = {
    hostContext?: Pick<HostContext, "createContractExecutor">;
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

    // The application owns its child; the supplied parent stays with the caller.
    const logger =
        options?.peerLogger?.child({ component: "ClientApp" }) ??
        createLogger(
            { peerId: options?.peerId, peerAddress: resolvedSignerAddress },
            { component: "ClientApp" },
            { attachErrorListener: true }
        );

    let root: P2pRuntimeClientRoot | undefined;
    let instance: P2pInstance<T, TCustomRpc> | undefined;
    try {
        // Client description of the app contract (rebuilt by the client).
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
            customPrecompiles: options?.customPrecompiles?.map(
                (precompile) => ({
                    ...precompile,
                    address: precompile.address.toString()
                })
            )
        };

        root = await createRoot(P2pRuntimeClientRoot, {
            args: {
                payload,
                signerAddress: resolvedSignerAddress
            },
            logger: logger.child({ component: P2pRuntimeClientRoot.name }),
            handlerExecutionContext: options?.handlerExecutionContext,
            local: dependencies
        });
        const remote = root.p2pRuntimeHostRemoteRoot!.rpc;
        const signer = new ClientP2pSigner(remote, resolvedSignerAddress);
        const chainSigner = new ClientChainSigner(
            remote,
            clientProvider,
            resolvedSignerAddress
        );
        const stateChannelManagerContract = connectStateChannelManager(
            scm.address,
            chainSigner,
            JSON.parse(scm.abiJson) as InterfaceAbi
        );
        const contract = new ethers.Contract(
            stateMachine.address,
            JSON.parse(stateMachine.abiJson),
            signer
        );
        instance = new P2pInstance<T, TCustomRpc>(root, {
            contract: contract as ethers.Contract & T,
            signer,
            chainSigner,
            stateChannelManagerContract,
            logger,
            hostRpc: createHostRpc<TCustomRpc>(remote)
        });
        // The client contract mirror: the same helper worker code uses.
        // Events are forwarded as { name, args } and re-emitted by event name,
        // so name-based and unindexed `contract.filters.X()` subscriptions
        // receive them. A subscription that filters on an indexed argument
        // (`contract.filters.X(indexedValue)`) resolves to a different ethers
        // tag and will NOT match — the original topics aren't forwarded.
        // A failed mirror emit reports through the bus error reporter.
        attachContractEvents(contract, root.events, undefined, {
            runtimeOwned: true
        });
        const deployBridgeSigner = new DeploymentBridgeSigner(
            remote,
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
        await remote.sdkSetup
            .deployComplete(
                localStateMachineAddress.toString(),
                diamondStateMachineAddress.toString()
            )
            .request();
        // On the main thread the surfaced WebRTC bridge port has no further
        // worker nesting to bubble up to, so wire it to the local
        // RTCPeerConnection here; inside a worker it stays on
        // p2pInstance.webRTCBridgePort for the consumer app to bubble up.
        root.installMainThreadBridgeIfOnMainThread();
        return instance;
    } catch (error) {
        try {
            if (instance) await instance.dispose();
            else await root?.dispose();
        } catch {
            // Preserve the setup failure after attempting all cleanup.
        } finally {
            // a setup that never returns an instance has nobody to hand the
            // logger to: dispose it here or it stays on the realm bus forever
            if (!instance) logger.dispose({ cascadeChildren: true });
        }
        throw error;
    }
}
