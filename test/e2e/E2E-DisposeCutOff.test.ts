import {
    assertDisposeCutsHeldBlockWork,
    assertDisposeCutsHeldDisputeUpload
} from "@test/fixtures/DisposeCutOffStaging";
import { MathTestSession as TestSession } from "@test/harness";

describe("E2E: dispose cut-off", function () {
    it("dispose during in-flight ingest sends nothing after the cut (worker)", async function () {
        await assertDisposeCutsHeldBlockWork(
            TestSession.getHarness(),
            "confirmationValidation"
        );
    });

    it("dispose during block production broadcasts nothing (worker)", async function () {
        await assertDisposeCutsHeldBlockWork(
            TestSession.getHarness(),
            "commit"
        );
    });

    it("dispose during a dispute upload held at the nonce mutex sends no transaction (worker)", async function () {
        await assertDisposeCutsHeldDisputeUpload(TestSession.getHarness());
    });
});
