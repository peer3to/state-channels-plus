import StateSnapshot from "@/models/StateSnapshot";
import { proofEvidence, storedProof } from "@test/factory";
import { localFinalizedView } from "@test/fixtures/ProofOwnerStaging";
import {
    assertAbortedInstallPublishesNoStoredProof,
    assertAuditKeepsStoredProof,
    assertGenesisResetStartsStoredProof,
    assertHistoryEditKeepsStoredFinalPoint,
    assertNonChangeAdvanceKeepsOneHop,
    assertOldForkAdvanceKeepsActiveStoredProof,
    assertReRootKeepsHopAboveAnchor,
    assertStaleAbortKeepsResponder,
    assertSyncAdvancesStoredProof,
    assertSyncFoldsNonChangeHop,
    assertSyncKeepsNotNewerStoredProof,
    persistSideChainSyncEvidence,
    readConflictFinalPoints
} from "@test/fixtures/StoredProofStaging";
import {
    readReceivedFinalHistory,
    servingSignedConflictAt,
    stageAnchoredHistory
} from "@test/fixtures/SyncProofStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";

describe("Unit: AgreementManager stored proof", function () {
    it("S4: a sync to a later final point than the stored one → the install stores the served final point with its state", async function () {
        await assertSyncAdvancesStoredProof(TestSession.getHarness());
    });

    it("a sync from the own final point whose last hop changes no membership → the served final point replaces that hop, the stored proof holds one hop", async function () {
        await assertSyncFoldsNonChangeHop(TestSession.getHarness());
    });

    it("final points with no membership change → each replaces the last hop, the stored proof holds one hop at the latest final point", async function () {
        await assertNonChangeAdvanceKeepsOneHop(TestSession.getHarness());
    });

    it("a side chain kept as sync evidence under the chain's upload cap → the record holds its start, the hop that conflicts with the own final point and its final point with its state", async function () {
        const outcome = await persistSideChainSyncEvidence(
            TestSession.getHarness(),
            "chain"
        );
        expect(outcome.kept).to.equal(`sync:${outcome.finalSnapshot.hash}`);
        expect(outcome.evidence).to.deep.include({
            hopHeights: [outcome.finalSnapshot.blockHeight],
            finalizedHash: String(outcome.finalSnapshot.hash),
            isStateHeld: true
        });
    });

    it("a side chain whose hops do not fit in a dispute upload → no sync evidence is kept", async function () {
        const outcome = await persistSideChainSyncEvidence(
            TestSession.getHarness(),
            0n
        );
        expect(outcome.kept).to.equal(null);
        expect(outcome.evidence).to.equal(null);
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

    it("the final history of a served proof that verified only from the anchor → its hop point above the anchor for both kills, proved exactly by its hop prefix; no other height is proved, and nothing is stored", async function () {
        const h = TestSession.getHarness();
        const { forkId, anchor, payload } = await stageAnchoredHistory(h, {
            blocksAfter: 2
        });
        const requester = h.getPeer(2);
        const localFinalized = (await localFinalizedView(h, requester.index))!;
        const served = await servingSignedConflictAt(
            h,
            payload,
            anchor,
            localFinalized.height
        );

        const history = await readReceivedFinalHistory(
            h,
            requester,
            forkId,
            served.payload,
            localFinalized.height - 1
        );

        expect(history).to.deep.equal({
            points: [
                {
                    height: localFinalized.height,
                    hash: String(served.finalSnapshot.hash),
                    proved: true
                }
            ],
            regressionHeights: [localFinalized.height],
            otherProved: false,
            unchanged: true
        });
    });
});
