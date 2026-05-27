// W2 - worker entry. ordered stages per §2.

// step 1 - side-effect imports first, before any module that allocates errors
// or stringifies BigInts.
import "./stackLimit";
import "./bigintJson";
// step 1 - register every shipped named rpc-stub handler + disconnect filter
// into this worker isolate. resolves the ids the orchestrator ships.
import "../../worker-handlers";

// step 1 - block holepunch's unconditional Hyperswarm DHT bind. tests run on
// LocalTransport (DEBUG_LOCAL_TRANSPORT=true) and never join() topics, but the
// DHT still opens UDP sockets at Holepunch construction time. those sockets
// hold the worker's libuv loop open at terminate() -> CheckedUvLoopClose abort.
// stub the global so `global.Hyperswarm || new Hyperswarm()` short-circuits
// to a quiet object with the methods Holepunch reads.
(global as unknown as { Hyperswarm: unknown }).Hyperswarm = {
    on: () => undefined,
    removeAllListeners: () => undefined,
    join: () => undefined,
    leave: () => undefined,
    destroy: async () => undefined,
    flush: async () => undefined
};

import { parentPort, workerData } from "node:worker_threads";

import { RpcServer } from "../rpc/rpc-server";
import { nodePortToRpcPort } from "./portCast";
import { toWireError } from "./serializeError";
import { SpyRegistry } from "./SpyRegistry";
import { startLoopGuard } from "./loopGuard";
import { registerSubHandleRoutes, W5BlockedError } from "./subHandleRoutes";
import { registerWorkerOpRoutes } from "./opRoutes";
import {
    LIFECYCLE_PUSH,
    LIFECYCLE_RPC,
    type BootstrapPhase,
    type CrashPayload,
    type DetachedRejectionPayload,
    type ReadyPayload,
    type WorkerData
} from "./types";

// step 1 - parentPort is the MessagePort the orchestrator handed us.
// (workerData carries plain data; the port arrives via the worker constructor.)
if (!parentPort) {
    throw new Error(
        "worker entry: parentPort missing - not running under a Worker"
    );
}

const data = workerData as WorkerData;
const port = parentPort;
const rpcPort = nodePortToRpcPort(port);

// step 1 - crash plumbing. capture before bootstrap so import-time exceptions
// surface to the orchestrator with attribution.
const phasesCompleted: BootstrapPhase[] = [];
let currentPhase: BootstrapPhase | undefined;

function postCrash(e: unknown, phase?: BootstrapPhase): void {
    const wire = toWireError(e);
    const payload: CrashPayload = {
        name: wire.name,
        message: wire.message,
        stack: wire.stack,
        phase
    };
    try {
        port.postMessage({
            kind: "push",
            topic: LIFECYCLE_PUSH.crash,
            payload
        });
    } catch {
        // port already closed; nothing to do
    }
}

process.on("uncaughtException", (e) => {
    postCrash(e, currentPhase);
    // step 1 - exit 99 -> orchestrator sees `exit` event with non-zero code
    process.exit(99);
});

process.on("unhandledRejection", (e) => {
    const wire = toWireError(e);
    const payload: DetachedRejectionPayload = {
        name: wire.name,
        message: wire.message,
        stack: wire.stack
    };
    try {
        port.postMessage({
            kind: "push",
            topic: LIFECYCLE_PUSH.detachedRejection,
            payload
        });
    } catch {
        // port already closed
    }
});

// step 1 - install rpc server early so lifecycle rpcs work during bootstrap
// failures + tests.
const server = new RpcServer(rpcPort);

// step 1 - W4 spy registry. wired here so the reset rpc + bump push topic
// work from boot onwards. event-handler proxy installation that calls
// registry.bump on every spy hit lands in p2pSetup (see runP2pSetup); until
// p2pSetup runs the registry is exercised via the spy.testBump handler.
const spyRegistry = new SpyRegistry(data.index, server);
spyRegistry.register();

// step 1 - EventHandler-method names the worker-side proxy bumps on. mirrors
// the EventHandler-method subset of EventSpies in test/harness/core/types.ts.
// P2pEventHooks names (onConnection, onTurn, ...) are inline-only until hooks
// ship to the worker; do not add them here without a hooks wire-through.
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

// step 1 - test-only handler so the worker can drive a bump without W5.
// real bumps come from the event-handler proxy once p2pSetup lands; see
// SpyRegistry.bump for the call shape.
server.register("spy.testBump", async (args) => {
    const { name, eventArgs } = (args ?? {}) as {
        name?: string;
        eventArgs?: readonly unknown[];
    };
    if (typeof name !== "string") {
        throw new Error("spy.testBump: missing 'name'");
    }
    spyRegistry.bump(name, eventArgs ?? []);
    return {};
});

// step 1 - W6 loop-delay guard. starts at boot; threshold from spawn args.
// guard pushes one frame per stall on the "loop.stall" topic; orchestrator
// marks the active test failed.
const loopGuard = startLoopGuard({
    workerIndex: data.index,
    thresholdMs: data.loopDelayMaxMs,
    server
});

// step 1 - W1 §6 sub-handle routes + named-op dispatcher. stateManager is
// constructed during p2pSetup (W5-blocked); the accessor below throws a
// clear W5 marker until then so handlers fail loud rather than NPE on
// undefined. when W5 lands, set `runtimeStateManager` after p2pSetup.
let runtimeStateManager: unknown = undefined;
let runtimeP2pInstance: unknown = undefined;
const getStateManager = (): never => {
    if (runtimeStateManager === undefined) {
        throw new W5BlockedError("stateManager");
    }
    return runtimeStateManager as never;
};
const getP2pInstance = (): never => {
    if (runtimeP2pInstance === undefined) {
        throw new W5BlockedError("p2pInstance");
    }
    return runtimeP2pInstance as never;
};

registerSubHandleRoutes(server, {
    getStateManager,
    saved: {},
    spyRegistry,
    rpcStubRestores: new Map(),
    disconnectFilterRestore: undefined
});

registerWorkerOpRoutes(server, { getStateManager, getP2pInstance });

// step 1 - test-only handler so the W6 acceptance test can trigger a
// real stall without needing prod code paths to hang. busy-loops for the
// requested duration (default 1500ms -> exceeds the 1000ms default threshold).
server.register("test.busyLoop", async (args) => {
    const { durationMs } = (args ?? {}) as { durationMs?: number };
    const ms = typeof durationMs === "number" ? durationMs : 1500;
    const deadline = Date.now() + ms;
    // step 1 - tight busy loop. cpu-bound -> event loop blocked -> guard fires.
    while (Date.now() < deadline) {
        // step 1 - intentional: blocking work, no microtask yield.
    }
    return { busyMs: ms };
});

// step 1 - lifecycle handlers. dispose returns durationMs (req/res). drainDetached
// is a separate rpc per W2 §5; for now it's a no-op pending DetachedPromises
// integration (// W?: defer to W2 follow-up when actions install detached promises).
server.register(LIFECYCLE_RPC.dispose, async () => {
    const start = Date.now();
    // W5 - p2pInstance.dispose() goes here once p2pSetup phase is wired. for now
    // boot-only workers have nothing to tear down beyond the rpc server.
    loopGuard.stop();
    return { durationMs: Date.now() - start };
});

server.register(LIFECYCLE_RPC.drainDetached, async () => {
    // W2 §5 - drain-detached is a separate rpc so afterEach can flush detached
    // promises without tearing the worker down. wired empty until the p2pSetup
    // phase lands the DetachedPromises seam.
    return { drained: 0 };
});

// step 1 - main bootstrap. two phases per D-20.
async function bootstrap(): Promise<void> {
    // step 1 - boot phase. logger / wallet construct / deployment resolve /
    // rpc handler registration. real I/O on chain access is in p2pSetup.
    currentPhase = "boot";
    // step 1 - import bundle manifest first so per-suite deployments + op
    // tables register against the canonical registries before resolveDeployment
    // runs. side-effect imports only; ordering matches the manifest.
    for (const modulePath of data.bundleManifest) {
        await import(modulePath);
    }
    const { resolveDeployment } = await import(
        "@test/harness/core/deploymentRegistry"
    );
    // step 2 - resolve deployment. fails fast with DeploymentNotFoundError if
    // the orchestrator shipped a name the worker doesn't have registered.
    const deployment = resolveDeployment(data.deploymentName);

    // step 3 - construct wallet from pk (D-15 - orchestrator owns the signer,
    // worker gets only the key for its own in-thread p2pSetup signer).
    const { ethers } = await import("ethers");
    const wallet = new ethers.Wallet(data.signerPk);
    const peerAddress = await wallet.getAddress();

    phasesCompleted.push("boot");

    // step 1 - p2pSetup phase. wired through boss's PR 339 polymorphic executor.
    // chain access is the remaining constraint: chainProviderUrl must point at an
    // HTTP-served hardhat (or equivalent) since hre.ethers.provider is per-isolate.
    // when undefined, stop after boot - the smoke flag for this branch is the
    // 2-peer threaded test (W5 seam doc).
    if (data.chainProviderUrl) {
        currentPhase = "p2pSetup";
        await runP2pSetup({
            wallet,
            deployment
        });
        phasesCompleted.push("p2pSetup");
    }

    currentPhase = undefined;

    // step 1 - ready handshake. ride W3 push envelope per D-21.
    const ready: ReadyPayload = { peerAddress, phasesCompleted };
    port.postMessage({
        kind: "push",
        topic: LIFECYCLE_PUSH.ready,
        payload: ready
    });
}

// step 1 - p2pSetup phase body. moved out of bootstrap so the dynamic imports
// (which pull in chain plumbing - LocalDiscoveryServer, hardhat-tied deploy
// helpers via the deployment closures) don't run for boot-only workers and
// keep the `boot` cold path cheap.
async function runP2pSetup(args: {
    wallet: import("ethers").Wallet;
    deployment: import("@test/harness/core/types").HarnessDeploymentConfig;
}): Promise<void> {
    const { wallet, deployment } = args;
    const { ethers } = await import("ethers");
    const { EvmStateMachine } = await import("@/evm");
    const { LocalDiscoveryServer } = await import("@/utils");
    const { StateChannelManagerProxy__factory } = await import(
        "@typechain-types"
    );

    // step 0 - apply test config in this isolate. orchestrator sends the same
    // overrides via harnessConfig.configOverrides; DEBUG_LOCAL_TRANSPORT=true
    // skips holepunch UDP allocation -> avoids the worker's libuv-close abort.
    const { createConfig } = await import("@/utils/config");
    createConfig(data.harnessConfig.configOverrides as never);

    // step 1 - chain provider. JsonRpcProvider against an HTTP-served hardhat is
    // the only cross-isolate path that works today; orchestrator passes the URL.
    // hre.ethers.provider is in-process per isolate and cannot be shared.
    // step 1a - fast polling so chain-event filter polling beats the harness
    // 2s barrier timeouts. ethers v6 default is 4s -> onSetState would never
    // wake within the test budget.
    const provider = new ethers.JsonRpcProvider(data.chainProviderUrl);
    provider.pollingInterval = 200;
    const signer = wallet.connect(provider);

    // step 2 - SCM proxy from the address the orchestrator shipped. typechain
    // factory only needs an ABI + address + signer; no hre dependency.
    const channelManager = StateChannelManagerProxy__factory.connect(
        data.channelManagerAddress,
        signer
    );

    // step 3 - state-machine deployer closure. the deployment record carries
    // the chain-side and local-side deploy bodies; the local deployer is what
    // p2pSetup feeds to deployLocalDiamond against the in-memory executor.
    const deployStateMachine: import("scripts/V1/deploy").LocalStateMachineDeployer =
        async (localSigner) =>
            (await deployment.deployLocalStateMachine({
                signer: localSigner,
                stateMachineGasLimit: data.harnessConfig.stateMachineGasLimit,
                disputeExecutionGasLimit:
                    data.harnessConfig.disputeExecutionGasLimit,
                timeConfig: data.harnessConfig.timeConfig,
                harnessConfig: data.harnessConfig.configOverrides
            })) as never;

    const contractInstanceMock = deployment.connectSigner(
        ethers.ZeroAddress,
        signer
    );

    // step 4a - P2pEventHooks wired through to spyRegistry.bump. these are the
    // hooks the prod state-machine fires inside the worker; bump pushes the
    // event into the orchestrator's SpyMirror over W3's push channel ->
    // waitForEventCounts wakes in the orchestrator thread. mirrors the
    // single-thread hooks shape in PeerTestHarness.ts:361-476 but drops the
    // peerLogger / barrier signal side-effects (orchestrator owns barriers).
    // step 4a-ii - forkId snapshot pusher. WorkerPeer caches forkId via a
    // "fork.changed" push (W1 D-12). worker pushes the current forkId after
    // any state-set: orchestrator's PeerHandle.forkId getter then reads
    // synchronously without an rpc round-trip. emitted forkId is "" before
    // any state has been set (matches inline pre-genesis behaviour).
    let lastPushedForkId: string | undefined;
    const maybePushForkId = (): void => {
        const fid = (runtimeStateManager as { forkId?: string } | undefined)
            ?.forkId;
        if (fid === undefined || fid === lastPushedForkId) return;
        lastPushedForkId = fid;
        server.push("fork.changed", { forkId: fid });
    };
    const hooks = {
        onConnection: (...args: unknown[]) =>
            spyRegistry.bump("onConnection", args),
        onDisconnection: (...args: unknown[]) =>
            spyRegistry.bump("onDisconnection", args),
        onTurn: (...args: unknown[]) => spyRegistry.bump("onTurn", args),
        onSetState: (...args: unknown[]) => {
            maybePushForkId();
            spyRegistry.bump("onSetState", args);
        },
        onStatusChanged: (...args: unknown[]) =>
            spyRegistry.bump("onStatusChanged", args),
        onPostingCalldata: (...args: unknown[]) =>
            spyRegistry.bump("onPostingCalldata", args),
        onPostedCalldata: (...args: unknown[]) =>
            spyRegistry.bump("onPostedCalldata", args),
        onDisputeStarted: (...args: unknown[]) =>
            spyRegistry.bump("disputeStarted", args),
        onInitiatingDispute: (...args: unknown[]) =>
            spyRegistry.bump("onInitiatingDispute", args),
        onDisputeUpdate: (...args: unknown[]) =>
            spyRegistry.bump("onDisputeUpdate", args),
        onDisputeAcknowledgment: (...args: unknown[]) =>
            spyRegistry.bump("onDisputeAcknowledgment", args),
        onBlockFinalized: (...args: unknown[]) =>
            spyRegistry.bump("onBlockFinalized", args),
        onBlockConfirmationProcessed: (...args: unknown[]) =>
            spyRegistry.bump("onBlockConfirmationProcessed", args)
    };

    // step 4 - p2pSetup. opts in to dedicatedEvmThread when the harnessConfig
    // override requests it (orthogonal to dedicatedPeerThread; we're already
    // inside the peer worker - VM_DEDICATED_THREAD spawns boss's EVM sub-worker).
    const p2pInstance = await EvmStateMachine.p2pSetup(
        signer,
        channelManager,
        contractInstanceMock as never,
        deployStateMachine,
        {
            peerId: data.index,
            p2pEventHooks: hooks as never,
            config: data.harnessConfig.configOverrides as never
        }
    );

    // step 5 - stash live stateManager so sub-handle routes resolve. cast
    // through unknown: p2pSigner exposes p2pManager at runtime; the typed
    // surface keeps it private.
    const p2pManager = (
        p2pInstance.p2pSigner as unknown as {
            p2pManager: { self: never; stateManager: unknown };
        }
    ).p2pManager;
    runtimeStateManager = p2pManager.stateManager;
    // step 5a - stash live p2pInstance so worker ops can submit txs against
    // `.p2pContractInstance.<methodName>(...args)` (math.add etc.).
    runtimeP2pInstance = p2pInstance;

    // step 5b - install worker-side spy proxy on the live eventHandler so
    // real events push frames to the orchestrator's SpyMirror. mirrors the
    // single-thread wrapEventHandlerWithSpies (PeerTestHarness.ts:667); only
    // the EventHandler-method subset of EventSpies lives here. P2pEventHooks
    // spies are inline-only until hooks are shipped to the worker.
    //
    // bump fires before the original -> the harness barrier wakes as soon as
    // the spy increments even if the original method throws.
    const stateManagerLive = runtimeStateManager as {
        eventHandler: Record<string, unknown>;
        stateChannelEventListener: { eventHandler: Record<string, unknown> };
    };
    const eventHandler = stateManagerLive.eventHandler;
    const eventHandlerProxy = new Proxy(eventHandler, {
        get(target, prop, receiver) {
            const original = Reflect.get(target, prop, receiver);
            if (typeof original !== "function") return original;
            if (typeof prop !== "string") return original;
            if (!EVENT_HANDLER_SPY_METHODS.has(prop)) return original;
            return function (this: unknown, ...args: unknown[]) {
                // step 1 - bump first -> barrier wakes regardless of throw.
                spyRegistry.bump(prop, args);
                return (original as (...a: unknown[]) => unknown).apply(
                    target,
                    args
                );
            };
        }
    });
    stateManagerLive.eventHandler = eventHandlerProxy;
    stateManagerLive.stateChannelEventListener.eventHandler = eventHandlerProxy;

    // step 6 - dial peers via LocalDiscoveryServer. orchestrator owns the
    // registry port; worker calls the connect side using its own P2PManager.
    // mirrors the inline path in NetworkController.connectPeers but runs from
    // inside the worker since the live P2PManager never leaves the thread.
    LocalDiscoveryServer.setLogger(
        (await import("@/utils")).createLogger(
            { peerId: data.index, peerAddress: await wallet.getAddress() },
            { component: "WorkerLocalDiscovery" },
            { level: data.logConfig.level, attachErrorListener: false }
        )
    );
    await LocalDiscoveryServer.connectToPeers(
        p2pManager.self,
        data.channelId as never,
        await wallet.getAddress(),
        // W2 D-17 - explicit port -> the worker's static discoveryPort is null
        // because tryStart() ran in the orchestrator isolate.
        data.discoveryRegistryPort
    );
}

bootstrap().catch((e) => {
    postCrash(e, currentPhase);
    // step 1 - defer exit so the crash push frame drains before the port closes.
    // setImmediate runs after the current microtask queue (which includes the
    // postMessage delivery).
    setImmediate(() => process.exit(99));
});
