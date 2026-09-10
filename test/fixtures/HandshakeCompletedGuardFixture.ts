// @spec-test-coverage-ignore: shared worker-runtime setup for HandshakeCompletedGuard tests
import type { RemoteRpcServices } from "@/rpc/RemoteRpcProxy";
import type { PingPongRpc } from "@test/fixtures/customRpc/PingPongRpcManifest";
import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import { DEFAULT_MATH_HARNESS_DEPLOYMENT } from "@test/harness/core/defaultMathHarnessDeployment";
import { MathStateMachine } from "@typechain-types";
import path from "node:path";

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

    public control(): RemoteRpcServices<PingPongRpc> {
        return this.harness.control(
            this.harness.getPeer(0)
        ) as RemoteRpcServices<PingPongRpc>;
    }
}
