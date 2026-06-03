// Stub Hyperswarm so Holepunch does not open UDP sockets that keep the worker alive at terminate().
(global as unknown as { Hyperswarm: unknown }).Hyperswarm = {
    on: () => undefined,
    removeAllListeners: () => undefined,
    join: () => undefined,
    leave: () => undefined,
    destroy: async () => undefined,
    flush: async () => undefined
};

import { MessagePort, parentPort, workerData } from "node:worker_threads";
import { ethers } from "ethers";
import type { Wallet } from "ethers";

import { PeerHandler } from "../rpc/PeerHandler";
import { PeerCaller } from "../rpc/PeerCaller";
import type { RpcPort } from "../rpc/rpc-types";
import { SpyRegistry } from "./SpyRegistry";
import { WorkerRoutes } from "./subHandleRoutes";
import { EvmStateMachine } from "@/evm";
import { LocalDiscoveryServer, createLogger } from "@/utils";
import { StateChannelManagerProxy__factory } from "@typechain-types";
import { createConfig } from "@/utils/config";
import type { Config } from "@/utils/config";
import StateManager from "@/stateManager";
import type { HarnessDeploymentConfig } from "@test/harness/core/types";
import type { LocalStateMachineDeployer } from "scripts/V1/deploy";
import type P2pEventHooks from "@/P2pEventHooks";

import {
    type CrashPayload,
    type DetachedRejectionPayload,
    type WorkerData
} from "./types";
import { PUSH_TOPICS } from "./routeNames";

if (!parentPort) {
    throw new Error(
        "worker entry: parentPort missing - not running under a Worker"
    );
}

const EVENT_HANDLER_SPY_METHODS = new Set<string>([
    "onChannelOpened",
    "onStateSnapshotUpdated",
    "onBlockCalldataPosted",
    "onDisputeCommitted",
    "onChainSlashed",
    "onDisputeReducedResultCommitted",
    "onWithdrawalsUpdated",
    "onChannelStorageCleared",
    "onDisputeKilled",
    "onInboundMessagesProcessed"
]);

class PeerWorkerProcess {
    private stateManager: StateManager | undefined;
    private currentPhase: "boot" | "p2pSetup" | undefined;
    private lastPushedForkId: string | undefined;

    private readonly peerHandler: PeerHandler;
    private readonly workerPeerCaller: PeerCaller;
    private readonly spyRegistry: SpyRegistry;
    private readonly routes: WorkerRoutes;
    private readonly port: MessagePort;

    constructor(data: WorkerData, port: MessagePort) {
        this.port = port;
        const rpcPort: RpcPort = {
            postMessage: (v) => port.postMessage(v),
            close: () => port.close(),
            on: (event, listener) => {
                port.on(event, listener as (v: unknown) => void);
            },
            off: (event, listener) => {
                port.off(event, listener as (v: unknown) => void);
            }
        };
        this.peerHandler = new PeerHandler(rpcPort);
        this.workerPeerCaller = new PeerCaller(rpcPort);
        this.spyRegistry = new SpyRegistry(data.index, this.peerHandler);
        this.spyRegistry.register();
        this.routes = new WorkerRoutes(
            this.peerHandler,
            this.workerPeerCaller,
            data.index
        );

        process.on("uncaughtException", (e) => {
            this.postCrash(e, this.currentPhase);
            process.exit(99);
        });

        process.on("unhandledRejection", (e) => {
            const err = e instanceof Error ? e : new Error(String(e));
            const payload: DetachedRejectionPayload = {
                name: err.name,
                message: err.message,
                stack: err.stack
            };
            try {
                port.postMessage({
                    kind: "push",
                    topic: PUSH_TOPICS.lifecycleDetachedRejection,
                    payload
                });
            } catch {
                // port already closed
            }
        });

        this.bootstrap(data).catch((e) => {
            this.postCrash(e, this.currentPhase);
            setImmediate(() => process.exit(99));
        });
    }

    private postCrash(e: unknown, phase?: string): void {
        const err = e instanceof Error ? e : new Error(String(e));
        const payload: CrashPayload = {
            name: err.name,
            message: err.message,
            stack: err.stack,
            phase
        };
        try {
            this.port.postMessage({
                kind: "push",
                topic: PUSH_TOPICS.lifecycleCrash,
                payload
            });
        } catch {
            // port already closed
        }
    }

    private maybePushForkId(): void {
        const raw = this.stateManager?.forkId;
        const fid = typeof raw === "string" ? raw : undefined;
        if (fid === undefined || fid === this.lastPushedForkId) return;
        this.lastPushedForkId = fid;
        this.peerHandler.push(PUSH_TOPICS.forkChanged, { forkId: fid });
    }

    private async bootstrap(data: WorkerData): Promise<void> {
        this.currentPhase = "boot";
        const deployment = (await import(data.deploymentModule))
            .default as HarnessDeploymentConfig;
        const wallet = new ethers.Wallet(data.signerPk);
        const peerAddress = await wallet.getAddress();

        if (data.chainProviderUrl) {
            this.currentPhase = "p2pSetup";
            await this.runP2pSetup(data, wallet, deployment);
        }

        this.currentPhase = undefined;
        const ready = { peerAddress };
        this.port.postMessage({
            kind: "push",
            topic: PUSH_TOPICS.lifecycleReady,
            payload: ready
        });
    }

    private async runP2pSetup(
        data: WorkerData,
        wallet: Wallet,
        deployment: HarnessDeploymentConfig
    ): Promise<void> {
        const {
            harnessConfig,
            index,
            channelManagerAddress,
            channelId,
            discoveryRegistryPort,
            logConfig,
            chainProviderUrl
        } = data;
        const peerAddress = await wallet.getAddress();

        createConfig(harnessConfig.configOverrides as Partial<Config>);

        const provider = new ethers.JsonRpcProvider(chainProviderUrl);
        provider.pollingInterval = 200;
        const signer = wallet.connect(provider);

        const channelManager = StateChannelManagerProxy__factory.connect(
            channelManagerAddress,
            signer
        );

        const deployStateMachine: LocalStateMachineDeployer = async (
            localSigner
        ) =>
            (await deployment.deployLocalStateMachine({
                signer: localSigner,
                stateMachineGasLimit: harnessConfig.stateMachineGasLimit,
                disputeExecutionGasLimit:
                    harnessConfig.disputeExecutionGasLimit,
                timeConfig: harnessConfig.timeConfig,
                harnessConfig: harnessConfig.configOverrides
            })) as never;

        const contractInstanceMock = deployment.connectSigner(
            ethers.ZeroAddress,
            signer
        );

        const hooks = {
            onConnection: (...args: unknown[]) =>
                this.spyRegistry.bump("onConnection", args),
            onDisconnection: (...args: unknown[]) =>
                this.spyRegistry.bump("onDisconnection", args),
            onTurn: (...args: unknown[]) =>
                this.spyRegistry.bump("onTurn", args),
            onSetState: (...args: unknown[]) => {
                this.maybePushForkId();
                this.spyRegistry.bump("onSetState", args);
            },
            onStatusChanged: (...args: unknown[]) =>
                this.spyRegistry.bump("onStatusChanged", args),
            onPostingCalldata: (...args: unknown[]) =>
                this.spyRegistry.bump("onPostingCalldata", args),
            onPostedCalldata: (...args: unknown[]) =>
                this.spyRegistry.bump("onPostedCalldata", args),
            onDisputeStarted: (...args: unknown[]) =>
                this.spyRegistry.bump("disputeStarted", args),
            onInitiatingDispute: (...args: unknown[]) =>
                this.spyRegistry.bump("onInitiatingDispute", args),
            onDisputeUpdate: (...args: unknown[]) =>
                this.spyRegistry.bump("onDisputeUpdate", args),
            onDisputeAcknowledgment: (...args: unknown[]) =>
                this.spyRegistry.bump("onDisputeAcknowledgment", args),
            onBlockFinalized: (...args: unknown[]) =>
                this.spyRegistry.bump("onBlockFinalized", args),
            onBlockConfirmationProcessed: (...args: unknown[]) =>
                this.spyRegistry.bump("onBlockConfirmationProcessed", args)
        };

        const p2pInstance = await EvmStateMachine.p2pSetup(
            signer,
            channelManager,
            contractInstanceMock as never,
            deployStateMachine,
            {
                peerId: index,
                p2pEventHooks: hooks as unknown as P2pEventHooks, // hooks satisfies the shape; cast needed due to optional vs required method signatures
                config: harnessConfig.configOverrides as Partial<Config>
            }
        );

        this.stateManager = p2pInstance.p2pSigner.p2pManager.stateManager;
        this.routes.setRuntime(this.stateManager, p2pInstance);

        // Proxy eventHandler so real events push spy frames to the orchestrator.
        const sm = this.stateManager;
        const spyRegistry = this.spyRegistry;
        const eventHandlerProxy = new Proxy(sm.eventHandler, {
            get(target, prop, receiver) {
                const original = Reflect.get(target, prop, receiver);
                if (typeof original !== "function" || typeof prop !== "string")
                    return original;
                if (!EVENT_HANDLER_SPY_METHODS.has(prop)) return original;
                return async function (this: unknown, ...args: unknown[]) {
                    await (original as (...a: unknown[]) => unknown).apply(
                        target,
                        args
                    );
                    spyRegistry.bump(prop, args);
                };
            }
        });
        // stateChannelEventListener stores its own reference — both must be patched.
        // on-chain events flow through stateChannelEventListener.eventHandler;
        // p2p events flow through StateManager.eventHandler directly.
        sm.eventHandler = eventHandlerProxy;
        sm.stateChannelEventListener.eventHandler = eventHandlerProxy;

        LocalDiscoveryServer.setLogger(
            createLogger(
                { peerId: index, peerAddress },
                { component: "WorkerLocalDiscovery" },
                { level: logConfig.level, attachErrorListener: false }
            )
        );
        LocalDiscoveryServer.setRegistryPort(discoveryRegistryPort);
        await LocalDiscoveryServer.connectToPeers(
            p2pInstance.p2pSigner.p2pManager,
            channelId,
            peerAddress
        );
    }
}

new PeerWorkerProcess(workerData as WorkerData, parentPort);
