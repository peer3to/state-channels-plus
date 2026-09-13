import {
    assertAbortClosesRuntime,
    assertAbortCancelsTimeout,
    assertProviderShutdownOrder
} from "@test/fixtures/RuntimeAbortFixture";

describe("StateManager abort", function () {
    it("stops host work before provider destruction and final listener removal", async function () {
        await assertProviderShutdownOrder();
    });
    it("disposes the inline host and executor roots on abort", async function () {
        await assertAbortClosesRuntime(false);
    });
    it("disposes the worker host and executor roots on abort", async function () {
        await assertAbortClosesRuntime(true);
    });
    it("cancels session-owned timeout work", async function () {
        await assertAbortCancelsTimeout();
    });
});
