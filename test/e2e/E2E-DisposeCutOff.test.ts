import {
    assertDisposeCutsHeldBlockWork,
    assertDisposeCutsHeldDisputeUpload,
    assertDisposedRuntimeFiresNothing,
    assertInlineSiblingFailureAfterCutSurfaces
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

    it("a disposed runtime's timer, chain logs and double-signature listener fire nothing while its disposal ends (worker)", async function () {
        await assertDisposedRuntimeFiresNothing(TestSession.getHarness());
    });

    it("an inline sibling's failure after a peer's disposal still surfaces in the drain", async function () {
        await assertInlineSiblingFailureAfterCutSurfaces(
            TestSession.getHarness()
        );
    });
});
