import {
    assertContractRoundTrip,
    assertCustomRootReadiness,
    assertGeneratedHostSigner,
    assertRejectedCustomRootReadiness,
    assertDisposedSessionLeavesTheFlushTree,
    assertFailedSetupLeavesNoRootOnTheFlushBus,
    assertReportABugReportsItsThreads,
    assertRpcHandlerEntersWithoutMutex,
    assertSdkThreadCrashUploadsEveryThread,
    startRuntimeTransportModesFixture,
    stopRuntimeTransportModesFixture
} from "@test/fixtures/RuntimeTransportModesFixture";

describe("E2E: p2pSetup runtime modes", function () {
    before(async function () {
        await startRuntimeTransportModesFixture();
    });

    after(function () {
        stopRuntimeTransportModesFixture();
    });

    it("connects and round-trips contract calls in inline/inline-vm mode", async function () {
        await assertContractRoundTrip(false, false);
    });

    it("connects and round-trips contract calls in inline/dedicated-vm mode", async function () {
        await assertContractRoundTrip(false, true);
    });

    it("connects and round-trips contract calls in worker/inline-vm mode", async function () {
        await assertContractRoundTrip(true, false);
    });

    it("connects and round-trips contract calls in worker/dedicated-vm mode", async function () {
        await assertContractRoundTrip(true, true);
    });

    it("waits for custom root readiness in inline mode", async function () {
        await assertCustomRootReadiness(false);
    });

    it("waits for custom root readiness in worker mode", async function () {
        await assertCustomRootReadiness(true);
    });

    it("enters a custom RPC handler without the state mutex in inline mode", async function () {
        await assertRpcHandlerEntersWithoutMutex(false);
    });

    it("enters a custom RPC handler without the state mutex in worker mode", async function () {
        await assertRpcHandlerEntersWithoutMutex(true);
    });

    it("rejects and cleans up failed custom root readiness in inline mode", async function () {
        await assertRejectedCustomRootReadiness(false);
    });

    it("rejects and cleans up failed custom root readiness in worker mode", async function () {
        await assertRejectedCustomRootReadiness(true);
    });

    it("generates a host-owned signer when no secret is supplied", async function () {
        await assertGeneratedHostSigner();
    });

    it("uploads both threads when the sdk thread crashes", async function () {
        await assertSdkThreadCrashUploadsEveryThread();
    });

    it("report-a-bug returns the threads it uploaded", async function () {
        await assertReportABugReportsItsThreads();
    });

    it("a closed session leaves no root on the flush bus", async function () {
        await assertDisposedSessionLeavesTheFlushTree();
    });

    it("a failed setup leaves no root on the flush bus", async function () {
        await assertFailedSetupLeavesNoRootOnTheFlushBus();
    });
});
