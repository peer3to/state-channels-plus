import { DisputeFraudProofType } from "@/types/sol-enums";
import { Codec, Type } from "@/utils";
import {
    commitmentOf,
    committedDisputeLogs,
    computeLocalReduction,
    killedDisputeLogs,
    latestProofBlock,
    releaseReductions,
    stageHigherStateOverOpener,
    stageOffWireBlock,
    prepareLateFalseTimeoutDispute,
    uploadLateLowerStateDispute,
    waitPastKillPeriod
} from "@test/fixtures/DisputeWindowWorkflowStaging";
import { disputeOnHost } from "@test/fixtures/ReplayGasLimitStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { ZeroAddress } from "ethers";

/**
 * Protocol input for the evidence-timing cases: a lower-state dispute is
 * uploaded `LATE_MARGIN_SECONDS` before the evidence period of
 * `EVIDENCE_TIME` seconds closes, after the higher state was admitted.
 */
const EVIDENCE_TIME = 15;
const LATE_MARGIN_SECONDS = 7;

/**
 * Plan 35 (milestone-only state proof): what a peer submits when the dispute
 * window opens (E47, E48), persistence-only replay beyond a frozen view and
 * the peer's own proof after it (E19 with its extension), and the deferred
 * loss of the only higher-state commitment.
 */
describe("E2E: evidence in the dispute window", function () {
    it("E47: a peer whose frozen view is above the opening dispute submits its higher state at once; a lower-state dispute admitted after the higher evidence needs no new upload, its own false timeout is still countered, and reduction keeps the higher state", async function () {
        const h = TestSession.getHarness();
        const {
            forkId,
            leader,
            offender,
            opener,
            late,
            authored,
            height,
            restoreLeaderNetwork
        } = await stageHigherStateOverOpener(h, {
            evidenceTime: EVIDENCE_TIME
        });
        const comparisons = await h.rpcStub.recordEvidenceComparisons(
            leader.index
        );
        const leaderUploads = await h.rpcStub.recordDisputeSubmissions(
            leader.index,
            { forward: true }
        );

        const uploadLower = await prepareLateFalseTimeoutDispute(
            h,
            late.index,
            opener.address,
            forkId
        );

        // the opener disputes the offender's block from height - 1
        await h.byzantine.submitInvalidStateTransitionBlock(offender.index);
        await h.assert.dispute.initiatedWait({ peersIndices: [opener.index] });
        // the leader's higher state goes in from its audit of the opener
        await waitFor(
            async () =>
                (await leaderUploads.submissions()).some(
                    (submission) => submission.waited
                ),
            h.event.protocolEventTimeoutMs()
        );
        const [openingAudit] = await comparisons.audits();
        expect(openingAudit.answer).to.equal(true);
        const higher = Codec.decode(
            (await leaderUploads.submissions())[0].encodedDispute,
            Type.Dispute
        );
        expect(latestProofBlock(higher).hash).to.equal(authored.hash);
        await restoreLeaderNetwork();

        // the late peer's lower-state dispute claims a false timeout: it names
        // the opener, not the leader, as the writer of the next block
        const lower = await uploadLower(LATE_MARGIN_SECONDS);
        expect(latestProofBlock(lower.dispute).height).to.equal(height - 1);
        expect(lower.dispute.input.timeout.participant).to.equal(
            opener.address
        );
        expect(Number(lower.dispute.input.timeout.blockHeight)).to.equal(
            height
        );
        // its timeout claim is audited on its own and countered
        await h.event.waitForPeers(
            "onDisputeKilled",
            [leader.index, opener.index],
            1,
            { mode: "atLeast" }
        );
        await h.assert.storage.honestPeersStoredDisputeFraudProof({
            disputeFraudProofType:
                DisputeFraudProofType.TimeoutParticipantNotNext,
            atLeastOneHonestPeer: true
        });
        const killed = await killedDisputeLogs(h);
        expect(killed).to.have.length(1);
        expect(killed[0].disputer).to.equal(late.address);
        await h.event.waitUntilTimestamp(lower.evidenceEnd + 1);

        // the higher state was admitted before the lower one and is not
        // uploaded again
        const disputers = (await committedDisputeLogs(h)).map(
            (log) => log.disputer
        );
        expect(disputers.indexOf(leader.address)).to.be.at.least(0);
        expect(disputers.indexOf(leader.address)).to.be.lessThan(
            disputers.indexOf(late.address)
        );
        expect(await leaderUploads.submissions()).to.have.length(1);
        expect(await comparisons.comparisons()).to.have.length(1);
        const laterAnswers = (await comparisons.audits())
            .slice(1)
            .map((audit) => audit.answer);
        expect(laterAnswers).to.not.include(true);
        const commitments = await h.channelManager.getWindowCommitments(
            h.channelId,
            forkId
        );
        expect(commitments).to.include(commitmentOf(higher));
        expect(commitments).to.not.include(commitmentOf(lower.dispute));

        const period = await waitPastKillPeriod(h, forkId, opener.index);
        expect(period.isExpired).to.equal(true);
        const reduction = await computeLocalReduction(h, opener.index, forkId);
        expect(reduction.latestBlockHeight).to.equal(height);
        expect(reduction.latestBlockStateSnapshotHash).to.equal(
            authored.stateSnapshotHash
        );
        expect([...reduction.slashedParticipants].sort()).to.deep.equal(
            [offender.address, late.address].sort()
        );
        expect(reduction.selfRemovals).to.deep.equal([]);
        expect(reduction.timeoutParticipant).to.equal(ZeroAddress);

        await releaseReductions(h);
        await h.dispute.resolveDisputeWait({
            forkId,
            honestPeerIndices: [leader.index, opener.index]
        });
        const participants = await h
            .control(opener)
            .query.getParticipants()
            .request();
        expect([...participants].sort()).to.deep.equal(
            [leader.address, opener.address].sort()
        );
    });

    it("E48: when the opening dispute already represents a peer's evidence, a lower-state dispute admitted near evidence closure gets no duplicate upload from that peer, and reduction keeps the higher state and the later dispute's own claim", async function () {
        const h = TestSession.getHarness();
        const { forkId, leader, others, authored, height } =
            await stageOffWireBlock(h, { evidenceTime: EVIDENCE_TIME });
        const [auditorIndex, bystanderIndex, lateIndex] = others;
        const auditor = h.getPeer(auditorIndex);
        const late = h.getPeer(lateIndex);
        await h.dispute.suppressDisputeInitiation([lateIndex]);
        const comparisons =
            await h.rpcStub.recordEvidenceComparisons(auditorIndex);
        // record-only: an upload attempt by the auditor is recorded, not sent
        const auditorUploads =
            await h.rpcStub.recordDisputeSubmissions(auditorIndex);
        const leaderUploads = await h.rpcStub.recordDisputeSubmissions(
            leader.index,
            { forward: true }
        );

        // the leader opens the window with its higher state
        await h.control(leader).dispute.setForceExit(true).request();
        await disputeOnHost(h, leader.index, forkId);
        const opening = Codec.decode(
            (await leaderUploads.submissions())[0].encodedDispute,
            Type.Dispute
        );
        expect(latestProofBlock(opening).hash).to.equal(authored.hash);
        // the auditor's own dispute adds nothing to the opening one
        // the answer is set after the comparison's construction settles and
        // its reductions run: wait for the audit itself
        await waitFor(
            async () => (await comparisons.audits())[0]?.outcome === "resolved",
            h.event.protocolEventTimeoutMs()
        );
        const [openingAudit] = await comparisons.audits();
        expect(openingAudit.answer).to.equal(false);

        const lower = await uploadLateLowerStateDispute(
            h,
            lateIndex,
            forkId,
            LATE_MARGIN_SECONDS
        );
        expect(lower.waited).to.equal(true);
        expect(latestProofBlock(lower.dispute).height).to.equal(height - 1);
        await h.event.waitForPeers("onDisputeCommitted", [auditorIndex], 2, {
            mode: "atLeast"
        });
        await h.event.waitUntilTimestamp(lower.evidenceEnd + 1);

        expect(await auditorUploads.submissions()).to.deep.equal([]);
        expect(await comparisons.comparisons()).to.have.length(1);
        const answers = (await comparisons.audits()).map(
            (audit) => audit.answer
        );
        expect(answers).to.not.include(true);
        const commitments = await h.channelManager.getWindowCommitments(
            h.channelId,
            forkId
        );
        expect(commitments).to.include(commitmentOf(opening));
        expect(commitments).to.include(commitmentOf(lower.dispute));
        expect(await killedDisputeLogs(h)).to.deep.equal([]);
        await h.assert.storage.honestPeersStoredNoDisputeFraudProofs();

        const period = await waitPastKillPeriod(h, forkId, auditorIndex);
        expect(period.isExpired).to.equal(true);
        const reduction = await computeLocalReduction(h, auditorIndex, forkId);
        expect(reduction.latestBlockHeight).to.equal(height);
        expect(reduction.latestBlockStateSnapshotHash).to.equal(
            authored.stateSnapshotHash
        );
        expect(reduction.slashedParticipants).to.deep.equal([]);
        expect([...reduction.selfRemovals].sort()).to.deep.equal(
            [leader.address, late.address].sort()
        );
        expect(reduction.timeoutParticipant).to.equal(ZeroAddress);

        await releaseReductions(h);
        await h.dispute.resolveDisputeWait({
            forkId,
            honestPeerIndices: [auditorIndex, bystanderIndex]
        });
        const participants = await h
            .control(auditor)
            .query.getParticipants()
            .request();
        expect([...participants].sort()).to.deep.equal(
            [auditor.address, h.getPeer(bystanderIndex).address].sort()
        );
    });

    it("E19: an auditor frozen by its own dispute replays a higher dispute as stored data only: no view change and no new signature, its own proof and dispute stay at the frozen height, and the reduction after the kill window uses the replayed state", async function () {
        const h = TestSession.getHarness();
        const {
            forkId,
            leader,
            offender,
            opener,
            late,
            authored,
            height,
            restoreLeaderNetwork
        } = await stageHigherStateOverOpener(h);
        const openerUploads = await h.rpcStub.recordDisputeSubmissions(
            opener.index,
            { forward: true }
        );
        const leaderUploads = await h.rpcStub.recordDisputeSubmissions(
            leader.index,
            { forward: true }
        );
        const landed = async (
            recording: typeof openerUploads
        ): Promise<boolean> =>
            (await recording.submissions()).some(
                (submission) => submission.waited
            );

        await h.byzantine.submitInvalidStateTransitionBlock(offender.index);
        await waitFor(
            () => landed(openerUploads),
            h.event.protocolEventTimeoutMs()
        );
        // the opener's view is frozen at its dispute, below the off-wire block
        const frozen = Codec.decode(
            (await openerUploads.submissions())[0].encodedDispute,
            Type.Dispute
        );
        expect(latestProofBlock(frozen).height).to.equal(height - 1);
        await waitFor(
            () => landed(leaderUploads),
            h.event.protocolEventTimeoutMs()
        );
        const higher = Codec.decode(
            (await leaderUploads.submissions())[0].encodedDispute,
            Type.Dispute
        );
        expect(latestProofBlock(higher).hash).to.equal(authored.hash);
        await restoreLeaderNetwork();

        // the opener's audit of the higher dispute stores the off-wire block,
        // its snapshot and its state
        const storedChain = (peerIndex: number) =>
            h
                .control(h.getPeer(peerIndex))
                .query.assertStoredBlockChain(forkId, height)
                .request();
        await waitFor(
            async () => (await storedChain(opener.index)).ok,
            h.event.protocolEventTimeoutMs()
        );
        await waitFor(
            async () => (await storedChain(late.index)).ok,
            h.event.protocolEventTimeoutMs()
        );
        expect(await storedChain(opener.index)).to.deep.equal({
            ok: true,
            blockHash: authored.hash
        });

        const assertFrozen = async () => {
            const query = h.control(opener).query;
            expect(await query.getNextBlockHeight(forkId).request()).to.equal(
                height
            );
            const signed = await query
                .getLatestSignedBlockByParticipant(forkId, opener.address)
                .request();
            expect(signed?.height).to.equal(height - 1);
            // nobody holds the opener's signature on the replayed block
            for (const index of [opener.index, late.index]) {
                const stored = await h
                    .control(h.getPeer(index))
                    .query.getBlockByHeight(forkId, height)
                    .request();
                expect(stored?.confirmationSignerAddresses).to.not.include(
                    opener.address
                );
            }
        };
        await assertFrozen();

        // its own proof and dispute, built after the replay, stay at the
        // frozen view
        const { dispute: rebuilt } = await h.dispute.fetchConstructedDispute(
            opener.index,
            forkId
        );
        expect(latestProofBlock(rebuilt).hash).to.equal(
            latestProofBlock(frozen).hash
        );
        expect(rebuilt.input.latestStateSnapshotHash).to.equal(
            frozen.input.latestStateSnapshotHash
        );

        // after the kill window the opener's reduction reads the replayed state
        const period = await waitPastKillPeriod(h, forkId, opener.index);
        expect(period.isExpired).to.equal(true);
        const reduction = await computeLocalReduction(h, opener.index, forkId);
        expect(reduction.latestBlockHeight).to.equal(height);
        expect(reduction.latestBlockStateSnapshotHash).to.equal(
            authored.stateSnapshotHash
        );
        expect(reduction.latestStateSnapshotHeight).to.equal(height);
        expect(reduction.slashedParticipants).to.deep.equal([offender.address]);
        await assertFrozen();

        await releaseReductions(h);
        await h.dispute.resolveDisputeWait({ forkId });
    });

    it.skip("Deferred: losing the only higher-state commitment after evidence closes (different trusted starts, equal reduction outputs, no duplicate upload, a surviving lower commitment, a valid kill of the sole higher commitment after admission closes; control: the higher commitment survives) — pending: remediation oracle undecided", function () {});
});
