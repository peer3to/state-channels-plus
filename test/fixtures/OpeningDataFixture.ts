// @spec-test-coverage-ignore: shared runtime setup for opening-data negotiation component tests

import type { RemoteRpcProxyType } from "@/rpc/network/RemoteRpcProxy";
import type { OpeningDataRpc } from "@test/fixtures/customRpc/OpeningDataRpcManifest";
import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import { DEFAULT_MATH_HARNESS_DEPLOYMENT } from "@test/harness/core/defaultMathHarnessDeployment";
import { MathStateMachine } from "@typechain-types";
import path from "node:path";

/** Runtimes built with a custom root that supplies opening data. */
export class OpeningDataFixture {
    private readonly harness = new PeerTestHarness<
        OpeningDataRpc,
        MathStateMachine
    >({ deployment: DEFAULT_MATH_HARNESS_DEPLOYMENT });

    public async setup(): Promise<void> {
        await this.harness.setup(2, {
            autoConnect: false,
            customRpcManifest: {
                module: path.resolve(
                    __dirname,
                    "customRpc/OpeningDataRpcManifest.ts"
                )
            }
        });
    }

    public async cleanup(): Promise<void> {
        await this.harness.cleanup();
    }

    /** The probe on the first runtime. */
    public probe(): RemoteRpcProxyType<OpeningDataRpc>["openingDataProbe"] {
        return (
            this.harness.control(
                this.harness.getPeer(0)
            ) as RemoteRpcProxyType<OpeningDataRpc>
        ).openingDataProbe;
    }

    /** Budget for a probe that waits for an opening observed on-chain. */
    public openingTimeoutMs(): number {
        return this.harness.event.protocolEventTimeoutMs({
            withFirstBlockGrace: true
        });
    }
}
