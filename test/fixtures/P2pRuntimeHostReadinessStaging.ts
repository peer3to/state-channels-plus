// @spec-test-coverage-ignore: real pre-deployment runtime fixture
import {
    prepareRuntimeSetup,
    startRuntimeTransportModesFixture,
    stopRuntimeTransportModesFixture
} from "./RuntimeTransportModesFixture";

import type { RuntimeConnection } from "@/rpc/internal/AInternalRpcRoot";
import { P2pRuntimeClientRoot } from "@/rpc/internal/roots/P2pRuntimeClientRoot";
import type { P2pRuntimeHostRoot } from "@/rpc/internal/roots/P2pRuntimeHostRoot";
import type { HostRootManifest } from "@/rpc/internal/roots/resolveHostRootManifest";
import { setupObservedP2pRuntime as setupP2pRuntime } from "@test/fixtures/node/ObservedP2pSetup";
import { expect } from "chai";

export async function checkPreDeploymentRequest<
    THost extends P2pRuntimeHostRoot = P2pRuntimeHostRoot
>(
    request: (connection: RuntimeConnection<THost>) => Promise<unknown>,
    succeeds = false,
    hostRootManifest?: HostRootManifest<THost>
): Promise<void> {
    await startRuntimeTransportModesFixture();
    const setup = await prepareRuntimeSetup({
        runSdkInThread: false,
        vmDedicatedThread: false
    });
    let connection: RuntimeConnection<THost>;
    let checked = false;
    try {
        const instance = await setupP2pRuntime(
            setup.scm,
            setup.deployedStateMachine,
            async (signer) => {
                if (!checked) {
                    checked = true;
                    let result: unknown;
                    let failure: unknown;
                    try {
                        result = await request(connection);
                    } catch (error) {
                        failure = error;
                    }
                    if (succeeds) {
                        expect(failure).to.equal(undefined);
                        expect(result).to.equal(await signer.getAddress());
                    } else {
                        expect(failure).to.be.instanceOf(Error);
                        expect((failure as Error).message).to.equal(
                            "Runtime is not ready"
                        );
                    }
                }
                return setup.deployStateMachine(signer);
            },
            { ...setup.setupOptions, hostRootManifest },
            {
                onRuntimeRoot: (root) => {
                    if (root instanceof P2pRuntimeClientRoot) {
                        connection = [...root.connections.values()][0]
                            .rpc as RuntimeConnection<THost>;
                    }
                }
            }
        );
        await instance.dispose();
        expect(checked).to.equal(true);
    } finally {
        stopRuntimeTransportModesFixture();
    }
}
