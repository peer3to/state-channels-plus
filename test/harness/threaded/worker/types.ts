// Worker-side type contract shipped via workerData. Must be structured-clone-safe.

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
};

export type WorkerData = {
    index: number;
    signerPk: string;
    channelId: string;
    discoveryRegistryPort: number;
    channelManagerAddress: string;
    deploymentModule: string;
    harnessConfig: SerializableHarnessConfig;
    logConfig: { level: "debug" | "verbose" | "info" | "warn" | "error" };
    chainProviderUrl?: string;
};

export type CrashPayload = {
    name: string;
    message: string;
    stack?: string;
    phase?: string;
};

export type DetachedRejectionPayload = {
    name: string;
    message: string;
    stack?: string;
};
