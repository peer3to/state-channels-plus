// @spec-test-coverage-ignore: worker SDK plus worker executor fault boundaries
import { setupObservedP2pRuntime } from "./ObservedP2pSetup";
import { withRuntimeRpc } from "../RpcRouterFixture";
import { prepareRuntimeSetup } from "../RuntimeTransportModesFixture";
import { P2pRuntimeClientRoot } from "@/rpc/internal/roots/P2pRuntimeClientRoot";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { randomUUID } from "node:crypto";
import { BroadcastChannel } from "node:worker_threads";

export async function assertTwoHopFailure(exit: boolean) {
    await withRuntimeRpc(async (sibling) => {
        const setup = await prepareRuntimeSetup({
            runSdkInThread: true,
            vmDedicatedThread: true
        });
        const name = randomUUID();
        const channel = new BroadcastChannel(name);
        let executing = false;
        let rejected: string | undefined;
        let hostExited = false;
        const errors: Error[] = [];
        channel.onmessage = (event) => {
            const data = (event as MessageEvent).data;
            if (data === "executing") executing = true;
            if (data?.rejected) rejected = data.rejected;
        };
        const instance = await setupObservedP2pRuntime(
            setup.scm,
            setup.deployedStateMachine,
            setup.deployStateMachine,
            setup.setupOptions,
            {
                workerUrl: require.resolve("./TwoHopHostEntry"),
                workerData: { channel: name },
                onWorker(worker) {
                    worker.once("exit", () => {
                        hostExited = true;
                    });
                },
                onRuntimeRoot(root) {
                    if (root instanceof P2pRuntimeClientRoot)
                        root.onHostError((error) => errors.push(error));
                }
            }
        );
        try {
            channel.postMessage("call");
            await waitFor(() => executing);
            if (exit) {
                channel.postMessage("exit-executor");
                await waitFor(
                    () => rejected !== undefined && errors.length > 0
                );
                expect(rejected).to.equal("Root worker exited with 29");
                expect(errors.map((error) => error.message)).to.deep.equal([
                    "Root worker exited with 29"
                ]);
            }
            await instance.dispose();
            await waitFor(() => hostExited);
            if (!exit) expect(errors).to.have.length(0);
            expect(
                await sibling.remote.runtimeProbe.sum(3, 4).request()
            ).to.equal(7);
        } finally {
            channel.postMessage("release");
            await instance.dispose();
            channel.close();
        }
    });
}
