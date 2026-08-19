// @spec-test-coverage-ignore: shared runtime setup for ARpcService component tests
import path from "node:path";

import { MathStateMachine } from "@typechain-types";
import { DEFAULT_MATH_HARNESS_DEPLOYMENT } from "@test/harness/core/defaultMathHarnessDeployment";
import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import type { PingPongRpc } from "@test/fixtures/customRpc/PingPongRpcManifest";
import type { ARpcDispatchProbe } from "@test/fixtures/customRpc/aRpcServiceProbe/ARpcServiceProbeService";
import type { LoopbackGuardProbeResult } from "@test/fixtures/customRpc/loopbackGuardProbe/LoopbackGuardProbeService";
import type { RemoteRpcProxyType } from "@/rpc/RemoteRpcProxy";

export class ARpcServiceFixture {
    private readonly harness = new PeerTestHarness<
        PingPongRpc,
        MathStateMachine
    >({
        deployment: DEFAULT_MATH_HARNESS_DEPLOYMENT
    });

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

    public probe(
        method: string,
        options: {
            request?: boolean;
            trusted?: boolean;
            guardPasses?: boolean;
            guarded?: boolean;
            withoutRpcMethodsPrototype?: boolean;
            requestId?: string;
            responseSendThrows?: boolean;
            shadowMode?: "accessor" | "nonFunction";
            params?: unknown[];
        } = {}
    ): Promise<ARpcDispatchProbe> {
        const peer = this.harness.getPeer(0);
        const control = this.harness.control(
            peer
        ) as RemoteRpcProxyType<PingPongRpc>;
        return control.aRpcServiceProbe
            .probeDispatch(method, {
                requestId: options.request
                    ? (options.requestId ?? "probe-request")
                    : undefined,
                trusted: options.trusted ?? false,
                guardPasses: options.guardPasses ?? true,
                guarded: options.guarded ?? true,
                withoutRpcMethodsPrototype:
                    options.withoutRpcMethodsPrototype ?? false,
                responseSendThrows: options.responseSendThrows ?? false,
                shadowMode: options.shadowMode,
                params: options.params ?? []
            })
            .request();
    }

    public probeRealLoopbackGuardBypass(): Promise<LoopbackGuardProbeResult> {
        const peer = this.harness.getPeer(0);
        const control = this.harness.control(
            peer
        ) as RemoteRpcProxyType<PingPongRpc>;
        return control.loopbackGuardProbe.probe().request();
    }
}
