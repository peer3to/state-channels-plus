// @spec-test-coverage-ignore: shared worker-runtime setup for HandshakeCompletedGuard tests
import path from "node:path";

import { MathStateMachine } from "@typechain-types";
import { DEFAULT_MATH_HARNESS_DEPLOYMENT } from "@test/harness/core/defaultMathHarnessDeployment";
import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import type { PingPongRpc } from "@test/fixtures/customRpc/PingPongRpcManifest";
import type { RemoteRpcProxyType } from "@/rpc/RemoteRpcProxy";

export class HandshakeCompletedGuardFixture {
    private readonly harness = new PeerTestHarness<
        PingPongRpc,
        MathStateMachine
    >({ deployment: DEFAULT_MATH_HARNESS_DEPLOYMENT });

    public async setup(): Promise<void> {
        await this.harness.setup(2, {
            autoConnect: false,
            customRpcManifest: {
                module: path.resolve(
                    __dirname,
                    "customRpc/PingPongRpcManifest.ts"
                )
            }
        });
    }

    public async cleanup(): Promise<void> {
        await this.harness.cleanup();
    }

    public control(): RemoteRpcProxyType<PingPongRpc> {
        return this.harness.control(
            this.harness.getPeer(0)
        ) as RemoteRpcProxyType<PingPongRpc>;
    }
}
