import {
    assertForkChangeResetsStoredProof,
    assertSnapshotUpdateReRootsStoredProof
} from "@test/fixtures/StoredProofStaging";
import { MathTestSession as TestSession } from "@test/harness";

describe("E2E: Stored proof", function () {
    it("a snapshot update re-roots every peer's stored proof at the posted snapshot, and a later final block advances it above that anchor", async function () {
        await assertSnapshotUpdateReRootsStoredProof(TestSession.getHarness());
    });

    it("a dispute moves the channel to a reduced fork → each honest peer's stored proof is on the new fork with its state, none on the old fork, and a final block advances it", async function () {
        await assertForkChangeResetsStoredProof(TestSession.getHarness());
    });
});
