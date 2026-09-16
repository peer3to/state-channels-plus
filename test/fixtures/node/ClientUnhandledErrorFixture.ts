// @spec-test-coverage-ignore: real client error policy in an isolated worker
import { withRuntimeRpc } from "../RpcRouterFixture";
import { expect } from "chai";
import { once } from "node:events";
import { Worker } from "node:worker_threads";

export async function assertUnobservedClientError(): Promise<void> {
    await withRuntimeRpc(async (sdk) => {
        const worker = new Worker(
            require.resolve("./ClientUnhandledErrorEntry"),
            {
                execArgv: [
                    "-r",
                    "ts-node/register/transpile-only",
                    "-r",
                    "tsconfig-paths/register"
                ],
                workerData: sdk.clientRoot["options"]
            }
        );
        const exited = once(worker, "exit");
        const [message] = await once(worker, "message");
        expect(message.message).to.equal("unobserved host failure");
        expect((await exited)[0]).to.equal(0);
    });
}
