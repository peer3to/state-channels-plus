import { assertCustomRpcRuntimeFlow } from "@test/fixtures/node/CustomRpcRuntimeFixture";

describe("E2E: custom RPC request/response over the runtime port", function () {
    it("lets an inline client drive self and peer RPC with failure recovery", async function () {
        await assertCustomRpcRuntimeFlow(false);
    });
    it("lets a worker client drive self and peer RPC with failure recovery", async function () {
        await assertCustomRpcRuntimeFlow(true);
    });
});
