import {
    assertDetachedFailureAfterRootDisposalIsSettled,
    assertDetachedFailureBeforeRootDisposalSurfaces
} from "@test/fixtures/DetachedWorkDisposalFixture";
import { assertWorkerParentLoss } from "@test/fixtures/node/LostParentFixture";
import {
    assertChildFailureWasmDiagnostics,
    assertRootDiagnostics
} from "@test/fixtures/node/RootDiagnosticsFixture";
import { assertTwoHopFailure } from "@test/fixtures/node/TwoHopFailureFixture";
import {
    assertRefusedHandleCloseStillDrains,
    assertWorkerSdkLeakEndsAfterDrainBound
} from "@test/fixtures/node/WorkerTeardownFixture";
import { assertReportDuringDisposalIsLogged } from "@test/fixtures/RuntimeLifecycleFixture";
import {
    assertLostDisposalReply,
    assertRootDisposalTree,
    assertRootLoggerCascade,
    assertSingleParent,
    assertLifecycleReadiness,
    assertLifecycleDisposal,
    assertLifecycleQuiescence,
    assertRepeatedHostQuiescence,
    assertLifecycleParentDirection
} from "@test/fixtures/RuntimeLifecycleFixture";
import {
    assertDisposalDuringBuild,
    assertDisposalDuringChainReads
} from "@test/fixtures/SetupDisposalFixture";
import { MathTestSession as TestSession } from "@test/harness";

describe("RuntimeLifecycle", () => {
    it("exits the SDK worker after its parent is lost during disposal", async () => {
        await assertWorkerParentLoss("dispose");
    });
    it("exits the SDK worker after its failed setup loses the error reply", async () => {
        await assertWorkerParentLoss("setup");
    });
    it("reports a ready SDK worker exit once with its original cause", async () => {
        await assertWorkerParentLoss("exit");
    });
    it("finishes final cleanup when the parent closes during an admitted disposal", async () => {
        await assertLostDisposalReply();
    });
    it("settles detached work that fails after root disposal as the disposal outcome", async () => {
        await assertDetachedFailureAfterRootDisposalIsSettled(
            TestSession.getHarness()
        );
    });
    it("logs a report raised while its root disposes and raises it to nobody", async () => {
        await assertReportDuringDisposalIsLogged();
    });
    it("keeps a detached failure before root disposal visible in the drain", async () => {
        await assertDetachedFailureBeforeRootDisposalSurfaces(
            TestSession.getHarness()
        );
    });
    it("automatically disposes root and application logger descendants and crash listeners", async () => {
        await assertRootLoggerCascade();
    });
    it("collects new host errors after an earlier inline drain", async () => {
        await assertRepeatedHostQuiescence(true);
    });
    it("collects new host errors after an earlier worker drain", async () => {
        await assertRepeatedHostQuiescence(false);
    });
    it("installs one slow-request observer for normal root creation", async () => {
        await assertRootDiagnostics(false);
    });
    it("records pending root requests once and ignores failures after closure", async () => {
        await assertRootDiagnostics(true);
    });
    it("logs the failed worker's WebAssembly diagnostics, or none for an ordinary error, and this thread's resources with pending requests", async () => {
        await assertChildFailureWasmDiagnostics();
    });
    it("disposes a standalone leaf once through the common root contract", async () => {
        await assertRootDisposalTree("leaf");
    });
    it("disposes a parent after its last child was already removed", async () => {
        await assertRootDisposalTree("empty");
    });
    it("awaits all sibling roots before the parent closes", async () => {
        await assertRootDisposalTree("siblings");
    });
    it("recursively closes nested descendants before their ancestors", async () => {
        await assertRootDisposalTree("nested");
    });
    it("rejects a second parent without changing the existing relationship", async () => {
        await assertSingleParent();
    });
    it("keeps children available while host shutdown preparation is held", async () => {
        await assertLifecycleDisposal(false, "held");
    });
    it("cleans children and local resources after host preparation fails", async () => {
        await assertLifecycleDisposal(false, "failed");
    });
    it("remembers a child readiness signal received before awaiting", async () => {
        await assertLifecycleReadiness("signal-first");
    });
    it("resolves waiting callers once when the child signals ready", async () => {
        await assertLifecycleReadiness("wait-first");
    });
    it("rejects readiness on child close without affecting a ready sibling", async () => {
        await assertLifecycleReadiness("close");
    });
    it("disposes children before local cleanup and shares repeated completion", async () => {
        await assertLifecycleDisposal(false);
    });
    it("runs local cleanup after a child disposal post failure", async () => {
        await assertLifecycleDisposal(true);
    });
    it("shares concurrent child quiescence and drains again after completion", async () => {
        await assertLifecycleQuiescence();
    });
    it("rejects cleanup requested upward without closing the parent", async () => {
        await assertLifecycleParentDirection();
    });
    it("acknowledges worker SDK abort with a worker executor before exiting while the parent is busy", async function () {
        await assertWorkerParentLoss("abort");
    });

    it("reports executor worker exit through a worker SDK and rejects its pending call", async function () {
        await assertTwoHopFailure(true);
    });
    it("disposes a worker SDK while its worker executor call is in flight", async function () {
        await assertTwoHopFailure(false);
    });
    it("acknowledges parent-requested worker SDK disposal before exiting while the parent is busy", async function () {
        await assertWorkerParentLoss("parent-dispose");
    });
    it("marks worker shutdown expected before parent port closure while client cleanup is held", async () => {
        await assertWorkerParentLoss("closed-parent");
    });
    it("completes worker SDK disposal when a handle refuses a second close during the worker's handle close", async () => {
        await assertRefusedHandleCloseStillDrains();
    });
    it("completes worker SDK disposal after the drain bound when the host leaks a referenced timer", async () => {
        await assertWorkerSdkLeakEndsAfterDrainBound();
    });
    it("disposes a worker runtime whose setup is held at its chain reads, and a fresh runtime for its signer works", async () => {
        await assertDisposalDuringChainReads(true);
    });
    it("disposes an inline runtime whose setup is held at its chain reads, and a fresh runtime for its signer works", async () => {
        await assertDisposalDuringChainReads(false);
    });
    it("cuts and disposes the runtime a worker setup builds after its disposal began, and a fresh runtime for its signer works", async () => {
        await assertDisposalDuringBuild(true);
    });
    it("cuts and disposes the runtime an inline setup builds after its disposal ended, and a fresh runtime for its signer works", async () => {
        await assertDisposalDuringBuild(false);
    });
});
