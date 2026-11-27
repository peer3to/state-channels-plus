import {
    assertAbortedInstallPublishesNoStoredProof,
    assertAuditKeepsStoredProof,
    assertHistoryEditKeepsStoredFinalPoint,
    assertOldForkAdvanceKeepsActiveStoredProof,
    assertStaleAbortKeepsResponder,
    assertSyncAdvancesStoredProof,
    assertSyncKeepsNotNewerStoredProof
} from "@test/fixtures/StoredProofStaging";
import { MathTestSession as TestSession } from "@test/harness";

describe("Unit: AgreementManager stored proof", function () {
    it("S4: a sync to a later final point than the stored one → the install stores the served final point with its state", async function () {
        await assertSyncAdvancesStoredProof(TestSession.getHarness());
    });

    it("S5: a sync to the final point already stored → the stored proof is unchanged", async function () {
        await assertSyncKeepsNotNewerStoredProof(TestSession.getHarness());
    });

    it("S6: the install aborts on a conflict after the stored proof was staged → neither the state nor the stored proof is published", async function () {
        await assertAbortedInstallPublishesNoStoredProof(
            TestSession.getHarness(),
            "conflict"
        );
    });

    it("S6: the stored proof changes after the sync staged its own → the install aborts, the state is not published and the staged proof is not written", async function () {
        await assertAbortedInstallPublishesNoStoredProof(
            TestSession.getHarness(),
            "storedProofChanged"
        );
    });

    it("S6: an install aborted because the stored proof changed meanwhile → no rejection, the responder is not blacklisted", async function () {
        await assertStaleAbortKeepsResponder(TestSession.getHarness());
    });

    it("A4: an audit verifies a later final point than the auditor's own → the stored proof is unchanged", async function () {
        await assertAuditKeepsStoredProof(TestSession.getHarness());
    });

    it("an advance of the old fork's stored proof after a fork change → nothing is written, the new fork's stored proof stays", async function () {
        await assertOldForkAdvanceKeepsActiveStoredProof(
            TestSession.getHarness()
        );
    });

    it("a stored block at the stored final point is dropped → the final point and the proof built over it are unchanged", async function () {
        await assertHistoryEditKeepsStoredFinalPoint(TestSession.getHarness());
    });
});
