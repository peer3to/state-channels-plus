import StateSnapshot from "@/models/StateSnapshot";
import { proofEvidence, storedProof } from "@test/factory";
import {
    assertAbortedInstallPublishesNoStoredProof,
    assertAuditKeepsStoredProof,
    assertGenesisResetStartsStoredProof,
    assertHistoryEditKeepsStoredFinalPoint,
    assertOldForkAdvanceKeepsActiveStoredProof,
    assertReRootKeepsHopAboveAnchor,
    assertStaleAbortKeepsResponder,
    assertSyncAdvancesStoredProof,
    assertSyncKeepsNotNewerStoredProof,
    readConflictFinalPoints
} from "@test/fixtures/StoredProofStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";

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

    it("a re-root at the snapshot below the stored final point → the anchor moves there, the hop above it and the final point with its state are kept", async function () {
        await assertReRootKeepsHopAboveAnchor(TestSession.getHarness());
    });

    it("a reset at the genesis of a reduced fork → its stored proof is that genesis alone with its state, and the old fork's is gone", async function () {
        await assertGenesisResetStartsStoredProof(TestSession.getHarness());
    });

    describe("conflict final points", function () {
        it("an evidence point is not used at a height where our stored proof has a point", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(2, 0);
            const forkId = h.activeForkId!;
            // own final points at heights 1 and 2
            const own = storedProof(forkId, 2);
            // the same hops at 1 and 2, then a hop at 3, where own has none
            const longer = storedProof(forkId, 3);
            const record = {
                ...proofEvidence(forkId, 3),
                proof: {
                    ...longer,
                    anchorSnapshot: own.anchorSnapshot,
                    hops: [...own.hops, longer.hops[2]]
                }
            };

            const read = await readConflictFinalPoints(h, 0, own, [record]);

            expect(read.evidenceBefore, "no evidence before").to.deep.equal([]);
            expect(
                read.own.map(({ height }) => height),
                "own points at 1 and 2"
            ).to.deep.equal([1, 2]);
            expect(read.evidence).to.deep.equal([
                {
                    hash: String(
                        StateSnapshot.from(longer.hops[2].snapshot).hash
                    ),
                    height: 3
                }
            ]);
        });

        it("an evidence record that conflicts with one of our own points is skipped", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(2, 0);
            const forkId = h.activeForkId!;
            // own final points at heights 1 and 2
            const own = storedProof(forkId, 2);
            // other snapshots at 1 and 2 than own's, and a hop at 3
            const conflicting = proofEvidence(forkId, 3);
            // own's hops at 1 and 2, then a hop at 4
            const longer = storedProof(forkId, 4);
            const agreeing = {
                ...proofEvidence(forkId, 4),
                proof: {
                    ...longer,
                    anchorSnapshot: own.anchorSnapshot,
                    hops: [...own.hops, longer.hops[3]]
                }
            };

            const read = await readConflictFinalPoints(h, 0, own, [
                conflicting,
                agreeing
            ]);

            expect(read.evidenceBefore, "no evidence before").to.deep.equal([]);
            expect(read.evidence).to.deep.equal([
                {
                    hash: String(
                        StateSnapshot.from(longer.hops[3].snapshot).hash
                    ),
                    height: 4
                }
            ]);
        });
    });
});
