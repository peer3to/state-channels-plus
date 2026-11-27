import StateSnapshot from "@/models/StateSnapshot";
import { Codec, Type } from "@/utils";
import {
    holdsEvidenceState,
    holdsState,
    stageAuditedHeadAboveView
} from "@test/fixtures/DisputeAuditStaging";
import {
    latestHeight,
    proofHeights,
    servedPayload,
    syncFromResponder
} from "@test/fixtures/MilestoneSyncStaging";
import { assertStaleBaseKeepsLocalState } from "@test/fixtures/MonotonicSyncInstallStaging";
import {
    assertConflictBeforeSyncCommit,
    assertConflictWhileHoldingBase,
    assertDisposalDuringSyncInstall,
    assertThrowDuringSyncCommit
} from "@test/fixtures/SyncInstallStaging";
import { stageSpectatorBehindUnfinalizedTail } from "@test/fixtures/SyncReplayBaseStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";

// persistSyncPayload keeps the requester's own state when its height on the
// base's fork is at or above the replay base (localLatestHeight >=
// baseHeight), with or without the base's state; otherwise it installs the
// base.

describe("Unit: SpectateService replay base", function () {
    it("requester's latest height equals the served base height → it keeps its own state as the replay base and syncs to the tip", async function () {
        const h = TestSession.getHarness();
        const { forkId, spectator, responder, tip } =
            await stageSpectatorBehindUnfinalizedTail(h, {
                finalBlocksWhileCutOff: 0
            });
        const baseHeight = proofHeights(
            await servedPayload(h, responder, forkId)
        ).at(-1)![0];
        // premise - the requester stands exactly at the base
        expect(await latestHeight(h, spectator, forkId)).to.equal(baseHeight);
        expect(baseHeight).to.be.lessThan(tip);
        await h
            .control(spectator)
            .stub.stubRecordUnsafeSetLatestState()
            .request();

        expect(
            await syncFromResponder(h, spectator, responder, forkId, tip)
        ).to.deep.equal({
            synced: true,
            rejections: [],
            blacklisted: false,
            latestHeight: tip
        });
        expect(
            await h
                .control(spectator)
                .stub.wasUnsafeSetLatestStateCalled()
                .request(),
            "the base must not be reinstalled over the requester's own state"
        ).to.equal(false);
        expect(
            await h
                .control(spectator)
                .query.getLatestStateMachineStateHash(forkId)
                .request()
        ).to.equal(
            await h
                .control(responder)
                .query.getLatestStateMachineStateHash(forkId)
                .request()
        );
    });

    it("requester kept the served base's state only as audit evidence and is served other bytes for it → it replays from the evidence state and syncs, the responder is not blacklisted", async function () {
        const h = TestSession.getHarness();
        const staged = await stageAuditedHeadAboveView(h);
        expect(staged.run).to.include({ outcome: "returned", isValid: true });
        await staged.restoreGossip();
        const requester = h.getPeer(staged.auditorIndex);
        const responder = h.getPeer(0);
        const payload = await servedPayload(h, responder, staged.forkId);
        // premise - the served base is the head the audit kept as evidence
        expect(
            StateSnapshot.from(payload.milestoneSnapshots.at(-1)!).hash
        ).to.equal(staged.headSnapshot.hash);
        expect(
            await holdsState(h, staged.auditorIndex, staged.headSnapshot)
        ).to.equal(false);
        expect(
            await holdsEvidenceState(
                h,
                staged.auditorIndex,
                staged.headSnapshot
            )
        ).to.equal(true);
        const otherBytes = { ...payload, latestFinalizedEncodedState: "0x01" };
        await h
            .control(responder)
            .stub.stubSpectatePayload(
                Codec.encode(otherBytes, Type.SyncPayload) as string
            )
            .request();

        const result = await syncFromResponder(
            h,
            requester,
            responder,
            staged.forkId,
            staged.headHeight
        );
        await h.control(responder).stub.restoreSpectateStaleProof().request();

        expect(result).to.include({ synced: true, blacklisted: false });
        expect(result.rejections).to.deep.equal([]);
    });

    it("requester's latest height one below the served base height → the base is installed, then the sync reaches the tip", async function () {
        const h = TestSession.getHarness();
        const { forkId, spectator, responder, tip } =
            await stageSpectatorBehindUnfinalizedTail(h, {
                finalBlocksWhileCutOff: 1
            });
        const baseHeight = proofHeights(
            await servedPayload(h, responder, forkId)
        ).at(-1)![0];
        // premise - the requester stands one below the base
        expect(await latestHeight(h, spectator, forkId)).to.equal(
            baseHeight - 1
        );
        await h
            .control(spectator)
            .stub.stubRecordUnsafeSetLatestState()
            .request();

        expect(
            await syncFromResponder(h, spectator, responder, forkId, tip)
        ).to.deep.equal({
            synced: true,
            rejections: [],
            blacklisted: false,
            latestHeight: tip
        });
        expect(
            await h
                .control(spectator)
                .stub.wasUnsafeSetLatestStateCalled()
                .request(),
            "below the base the requester installs it"
        ).to.equal(true);
        expect(
            await h
                .control(spectator)
                .query.getLatestStateMachineStateHash(forkId)
                .request()
        ).to.equal(
            await h
                .control(responder)
                .query.getLatestStateMachineStateHash(forkId)
                .request()
        );
    });

    describe("monotonic install", function () {
        it("requester jumped past the base through another source's sync, then a payload based there → local state kept, no install, the next live blocks execute with no fraud proof", async function () {
            await assertStaleBaseKeepsLocalState(
                TestSession.getHarness(),
                false
            );
        });

        it("pending joiner jumped past the base through another source's sync, then a payload based there → local state kept, stays pending, the next live blocks execute with no dispute", async function () {
            await assertStaleBaseKeepsLocalState(
                TestSession.getHarness(),
                true
            );
        });
    });

    describe("staged install", function () {
        it("a block conflicting with the served history lands between staging and commit → VM restored, nothing published, fork and status unchanged", async function () {
            await assertConflictBeforeSyncCommit(
                TestSession.getHarness(),
                true
            );
        });

        it("no conflict between staging and commit → the held install commits and the sync reaches the tip", async function () {
            await assertConflictBeforeSyncCommit(
                TestSession.getHarness(),
                false
            );
        });

        it("requester holds the base and a stored block conflicts with the served history → aborted, local state kept", async function () {
            await assertConflictWhileHoldingBase(TestSession.getHarness());
        });

        it("runtime disposed while the install is held → nothing reaches the responder or another peer after the cut, the disposal is not held", async function () {
            await assertDisposalDuringSyncInstall(TestSession.getHarness());
        });

        it("the install's commit callback throws after the VM write → VM restored to the pre-install state, fork unchanged, the sync rejects with that error and no verdict on the responder", async function () {
            await assertThrowDuringSyncCommit(TestSession.getHarness());
        });
    });
});
