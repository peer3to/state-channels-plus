import {
    assertGenuinePredecessorProofsKeepHonestSigners,
    assertOutsiderUnlinkedSnapshotSlashesNobody,
    assertParticipantUnlinkedSnapshotSlashesSubmitter
} from "@test/fixtures/UnlinkedPreviousSnapshotStaging";
import { MathTestSession as TestSession } from "@test/harness";

// an invalid-transition proof must bind its previous snapshot to the signed block
// before judging it -> a forged predecessor never slashes the honest signer
describe("E2E: unlinked previous snapshot in an invalid-transition proof", function () {
    it("outsider forging the predecessor of an honest first and later block slashes nobody", async function () {
        await assertOutsiderUnlinkedSnapshotSlashesNobody(
            TestSession.getHarness()
        );
    });

    it("participant forging the predecessor of an honest later block slashes only the submitter", async function () {
        await assertParticipantUnlinkedSnapshotSlashesSubmitter(
            TestSession.getHarness()
        );
    });

    it("genuine predecessor proofs against honest first and later blocks slash only a participant submitter", async function () {
        await assertGenuinePredecessorProofsKeepHonestSigners(
            TestSession.getHarness()
        );
    });
});
