import { assertDisposeCutsHeldBlockWork } from "@test/fixtures/DisposeCutOffStaging";
import { MathTestSession as TestSession } from "@test/harness";

describe("E2E: dispose cut-off", function () {
    it("dispose during in-flight ingest sends nothing after the cut (inline)", async function () {
        await assertDisposeCutsHeldBlockWork(
            TestSession.getHarness(),
            "confirmationValidation",
            true
        );
    });

    it("dispose during in-flight ingest sends nothing after the cut (worker)", async function () {
        await assertDisposeCutsHeldBlockWork(
            TestSession.getHarness(),
            "confirmationValidation",
            false
        );
    });

    it("dispose during block production broadcasts nothing (inline)", async function () {
        await assertDisposeCutsHeldBlockWork(
            TestSession.getHarness(),
            "commit",
            true
        );
    });

    it("dispose during block production broadcasts nothing (worker)", async function () {
        await assertDisposeCutsHeldBlockWork(
            TestSession.getHarness(),
            "commit",
            false
        );
    });
});
