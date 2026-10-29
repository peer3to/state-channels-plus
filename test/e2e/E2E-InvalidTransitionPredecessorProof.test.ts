import {
    assertGenuinePredecessorProofsKeepHonestSigners,
    assertGenuinePredecessorProofsOverMessageBlocksKeepSigners,
    assertOutsiderUnlinkedSnapshotSlashesNobody,
    assertParticipantUnlinkedSnapshotSlashesSubmitter
} from "@test/fixtures/InvalidTransitionPredecessorStaging";
import { MathTestSession as TestSession } from "@test/harness";

// an invalid-transition proof binds its previous snapshot to the signed block and replays it as
// clients build snapshots -> neither a forged nor a genuine predecessor slashes an honest signer
describe("E2E: invalid-transition proof predecessor binding and replay", function () {
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

    it("genuine predecessor proofs against client-built blocks with inbound and outbound messages slash no signer", async function () {
        await assertGenuinePredecessorProofsOverMessageBlocksKeepSigners(
            TestSession.getHarness()
        );
    });
});
