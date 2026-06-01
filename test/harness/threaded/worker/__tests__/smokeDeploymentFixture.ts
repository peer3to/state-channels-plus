import type { HarnessDeploymentConfig } from "@test/harness/core/types";

const SMOKE_DEPLOYMENT: HarnessDeploymentConfig<any> = {
    deployOnChainContracts: async () =>
        "0x0000000000000000000000000000000000000000",
    deployLocalStateMachine: async () =>
        "0x0000000000000000000000000000000000000000",
    connectSigner: (() => ({}) as any) as any
};

export default SMOKE_DEPLOYMENT;
