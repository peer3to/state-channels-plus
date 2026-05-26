// W2 smoke fixture - module that, when imported by both orchestrator and
// worker, registers the same deployment key on both isolates via side-effect.
// W2 §4 - worker imports the same canonical path; one registry, one source
// of truth.

import {
    registerDeployment,
    hasDeployment
} from "@test/harness/core/deploymentRegistry";
import type { HarnessDeploymentConfig } from "@test/harness/core/types";

export const SMOKE_DEPLOYMENT_KEY = "w2-smoke";

// step 1 - no-op deployment. boot phase only resolves the key; the bodies are
// never called in W2 smoke because p2pSetup is W5-deferred.
const SMOKE_DEPLOYMENT: HarnessDeploymentConfig<any> = {
    deployOnChainContracts: async () =>
        "0x0000000000000000000000000000000000000000",
    deployLocalStateMachine: async () =>
        "0x0000000000000000000000000000000000000000",
    connectSigner: (() => ({}) as any) as any
};

if (!hasDeployment(SMOKE_DEPLOYMENT_KEY)) {
    registerDeployment(SMOKE_DEPLOYMENT_KEY, SMOKE_DEPLOYMENT);
}
