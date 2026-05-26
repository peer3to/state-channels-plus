// W2 - worker-side type contract. shipped via workerData; must be
// structured-clone-safe (plain data, no functions, no class instances).

// W0 D-20 - exactly two phases. add more only when a real flake demands
// attribution.
export type BootstrapPhase = "boot" | "p2pSetup";

export type WorkerLogConfig = {
    level: "debug" | "verbose" | "info" | "warn" | "error";
    peerIndex: number;
};

// step 1 - SerializableHarnessConfig is the harnessConfig portions the worker
// needs verbatim. closures + class instances stripped. customPrecompiles /
// rpcServiceFactories are NOT here (D-19 -> spawn throws if non-empty).
export type SerializableHarnessConfig = {
    timeConfig: {
        p2pTime: number;
        agreementTime: number;
        chainFallbackTime: number;
        evidenceTime: number;
    };
    configOverrides: Record<string, unknown>;
    stateMachineGasLimit: number;
    disputeExecutionGasLimit: number;
    channelId: string;
    initialBalance: number;
};

export type WorkerData = {
    index: number;
    signerPk: string;
    channelId: string;
    discoveryRegistryPort: number;
    channelManagerAddress: string;
    deploymentName: string;
    harnessConfig: SerializableHarnessConfig;
    logConfig: WorkerLogConfig;
    testTitle: string;
    // step 1 - bundle manifest. W2 §4.5 - module paths that the worker imports
    // at boot to register per-suite deployments, op tables, rpc-stub handler
    // tables, etc. side-effect imports; modules self-register against the
    // canonical registries. orchestrator ships the same list per-test.
    bundleManifest: string[];
    // step 2 - W6 loop-delay guard threshold. default 1000ms per D-9; the
    // orchestrator can override via harnessConfig. one knob, session-wide.
    loopDelayMaxMs: number;
    // W5 - chain provider URL. JsonRpcProvider against an HTTP-served chain.
    // when undefined the worker stops after `boot`. PR 339's executor split
    // does NOT address chain access from a worker peer; hre.ethers.provider is
    // per-isolate. unblock paths: (a) HTTP-served hardhat, (b) chain-proxy seam.
    // see docs/parallel-plan-v2/W5-evm-in-thread-seam.md `what remains blocked`.
    chainProviderUrl?: string;
};

// step 1 - lifecycle frame shapes. ride W3's envelope per D-21.
export type ReadyPayload = {
    peerAddress: string;
    phasesCompleted: BootstrapPhase[];
};

export type CrashPayload = {
    name: string;
    message: string;
    stack?: string;
    phase?: BootstrapPhase;
};

export type DetachedRejectionPayload = {
    name: string;
    message: string;
    stack?: string;
};

export type LogPayload = {
    level: string;
    message: string;
    meta?: Record<string, unknown>;
};

// step 1 - lifecycle rpc method ids on W3. distinct namespace.
export const LIFECYCLE_RPC = {
    dispose: "lifecycle.dispose",
    drainDetached: "lifecycle.drainDetached"
} as const;

// step 1 - lifecycle push topics on W3.
export const LIFECYCLE_PUSH = {
    ready: "lifecycle.ready",
    crash: "lifecycle.crash",
    detachedRejection: "lifecycle.detachedRejection",
    log: "lifecycle.log"
} as const;
