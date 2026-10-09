import { DisputeFraudProofType } from "@/types/sol-enums";
import { Codec, hash, Type } from "@/utils";
import {
    eventPipelineOutcome,
    expectSlowAuditorLostRaceNoOp,
    stageReasonlessInitialDispute,
    stageRefusedKillAndDispute,
    stageSlowAuditorPastEvidencePeriod,
    stripDisputeReasons,
    waitUntilAuditsSettled
} from "@test/fixtures/DisputeAuditStaging";
import {
    killAndDisputeSpamDispute,
    killSpamDispute,
    waitForCommittedDisputeOf
} from "@test/fixtures/EvidenceComparisonStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

// a long evidence period keeps the staged kill and evidence deadlines apart
const EVIDENCE_TIME = 14;

describe("Unit: evidence submission when the dispute window opens", function () {
    it("U127: the initial dispute names a state below the peer's view -> the first audit finds more evidence and the peer's own dispute lands at once", async function () {
        const h = TestSession.getHarness();
        // peer 2 is away before block 0: its view is the genesis
        await h.scenario.preDisputeSetupDisconnectedPeer();
        for (const peer of h.peers) {
            await h.rpcStub.suppressTimeoutCheck(peer.index);
            await h.rpcStub.holdReductionRace(peer.index);
        }
        const recorder = await h.rpcStub.recordEvidenceComparisons(0);
        await h.control(h.getPeer(2)).dispute.setForceExit(true).request();
        const initial = await h.tamper.postTamperedDispute(2, () => {}, {
            markMalicious: false
        });
        expect(initial.dispute.input.stateProof.milestones).to.have.length(0);

        const own = await waitForCommittedDisputeOf(h, 1, h.getPeer(0).address);

        const audits = await recorder.audits();
        expect(audits[0]).to.include({ outcome: "resolved", answer: true });
        // the own dispute carries the peer's state above the initial genesis claim
        expect(own.input.stateProof.milestones.length).to.be.greaterThan(0);
    });

    it("U128: the initial dispute already represents the peer's state; a later lower-state dispute is still audited, and the peer submits nothing", async function () {
        const h = TestSession.getHarness();
        await h.scenario.preDisputeSetup({ peerCount: 4, transitionCount: 2 });
        const forkId = h.activeForkId!;
        for (const peer of h.peers) {
            await h.rpcStub.suppressTimeoutCheck(peer.index);
            await h.rpcStub.holdReductionRace(peer.index);
        }
        const latest = await h
            .control(h.getPeer(0))
            .query.getLatestBlockInfo(forkId)
            .request();
        // the latest author writes again only after every other peer
        const lower = h.peers.find((peer) => peer.address === latest!.author)!;
        await h.network.blacklistAndDisconnectPeer(lower.index);
        const live = h.peers
            .map((peer) => peer.index)
            .filter((index) => index !== lower.index);
        await h.transition.advanceState({ count: 1, waitForPeers: live });
        const [initiatorIndex, auditorIndex] = live as [number, number];
        const recorder =
            await h.rpcStub.recordEvidenceComparisons(auditorIndex);
        const submissions = await h.rpcStub.recordDisputeSubmissions(
            auditorIndex,
            { forward: true }
        );

        await h
            .control(h.getPeer(initiatorIndex))
            .dispute.setForceExit(true)
            .request();
        await h.tamper.postTamperedDispute(initiatorIndex, () => {}, {
            markMalicious: false
        });
        await waitUntilAuditsSettled(h, recorder, 1);
        expect((await recorder.audits())[0]).to.include({
            outcome: "resolved",
            answer: false
        });

        // the cut-off peer never saw the latest block: a lower state
        await h.control(lower).dispute.setForceExit(true).request();
        await h.tamper.postTamperedDispute(lower.index, () => {}, {
            markMalicious: false
        });
        await waitUntilAuditsSettled(h, recorder, 2);

        const audits = await recorder.audits();
        expect(audits[1]).to.include({ outcome: "resolved", answer: false });
        expect(await recorder.comparisons()).to.have.length(1);
        expect(await submissions.submissions()).to.have.length(0);
    });
});

describe("Unit: kill then dispute", function () {
    it("U129: the initial dispute is invalid -> the auditor's kill and its own dispute go in one multicall, kill first, carrying the killed submitter's slash, and land without another valid dispute", async function () {
        const h = TestSession.getHarness();
        const { spammer, submissions, waitUntilSettled } =
            await stageReasonlessInitialDispute(h, { hold: false });
        const forkId = h.activeForkId!;
        await waitUntilSettled();

        const recorded = await submissions.submissions();
        expect(recorded).to.have.length(1);
        const [submission] = recorded;
        expect(submission.method).to.equal("multicallBestEffortLast");
        expect(submission.innerMethods[0]).to.equal("applyDisputeFraudProofs");
        expect(["uploadDispute", "uploadDisputeWithCalldata"]).to.include(
            submission.innerMethods.at(-1)
        );
        expect(submission.revert).to.equal(null);
        expect(submission.waited).to.equal(true);
        const replacement = Codec.decode(
            submission.encodedDispute,
            Type.Dispute
        );
        expect(replacement.input.disputer).to.equal(h.getPeer(0).address);
        expect(replacement.input.onChainSlashes).to.include(spammer.address);
        await h.assert.dispute.slashedOnChain(spammer.address);
        expect(
            await h.channelManager.getWindowCommitments(h.channelId, forkId)
        ).to.include(hash(Codec.encode(replacement, Type.Dispute)));
    });

    it("U129: the replacement counts the killed submitter's slash -> held before the multicall that slash is not established and an auditor counters it; the multicall lands the kill first and the replacement passes", async function () {
        const h = TestSession.getHarness();
        const { spammer, submissions, waitUntilSettled } =
            await stageReasonlessInitialDispute(h, { hold: true });
        await submissions.waitUntilHeld();
        const [held] = await submissions.submissions();
        expect(held.innerMethods[0]).to.equal("applyDisputeFraudProofs");
        const replacement = Codec.decode(held.encodedDispute, Type.Dispute);
        const auditingData = held.encodedAuditingData
            ? Codec.decode(held.encodedAuditingData, Type.DisputeAuditingData)
            : undefined;
        expect(replacement.input.onChainSlashes).to.include(spammer.address);

        // before the kill: the replacement's slash is not on chain
        const early = await h.dispute.auditDispute(
            2,
            replacement,
            auditingData
        );
        expect(early).to.include({ outcome: "returned", isValid: false });
        expect(early.storedProof?.disputeFraudProofType).to.equal(
            DisputeFraudProofType.DisputeOnChainSlashesNotSubset
        );

        await submissions.release();
        await waitUntilSettled();
        const [landed] = await submissions.submissions();
        expect(landed.revert).to.equal(null);
        expect(landed.waited).to.equal(true);
        await h.assert.dispute.slashedOnChain(spammer.address);

        // after the kill in the same transaction: the slash is established
        const late = await h.dispute.auditDispute(3, replacement, auditingData);
        expect(late).to.include({ outcome: "returned", isValid: true });
        expect(late.storedProof).to.equal(undefined);
    });

    it("a slow auditor's kill and dispute land after another auditor's kill and replacement closed the evidence period → the multicall lands its kill, its refused upload is a no-op, no kill is sent alone, and its event pipeline stays alive", async function () {
        const h = TestSession.getHarness();
        const { forkId, slow, slowKills, slowSubmissions } =
            await stageSlowAuditorPastEvidencePeriod(h, {});

        // the slow auditor's multicall landed with its kill first; only its
        // upload was refused, and no kill was sent alone
        await waitFor(
            async () =>
                (await slowSubmissions.submissions()).some(
                    (submission) => submission.waited
                ),
            h.event.protocolEventTimeoutMs()
        );
        const [multicall] = await slowSubmissions.submissions();
        expect(multicall.method).to.equal("multicallBestEffortLast");
        expect(multicall.innerMethods[0]).to.equal("applyDisputeFraudProofs");
        expect(multicall.revert?.name).to.equal(
            "RaceConditionDisputeEvidencePeriodExpired"
        );
        // its dispute did not land, and its marker rolled back
        expect(
            await h.channelManager.getWindowCommitments(h.channelId, forkId)
        ).to.have.length(1);
        expect(
            await h.execOnHost(
                slow,
                (sm, args) => sm.storage.disputes.didIDispute(args.forkId),
                { forkId }
            )
        ).to.equal(false);

        // every dispute event the slow auditor handled settled without a
        // pipeline failure, and it was not aborted
        await h.rpcStub.waitUntilDisputeMutexIdle(slow.index);
        expect(await eventPipelineOutcome(h, slow.index)).to.deep.equal({
            failedBlocks: 0,
            isDisposed: false
        });
        expect(await slowKills.applies()).to.deep.equal([]);
        expect(await slowSubmissions.submissions()).to.have.length(1);
    });

    it("a slow auditor's kill and dispute land after the evidence period closed, and a searching estimator gives the best-effort multicall only the least gas at which it succeeds → the upload still reaches its evidence check and names the lost evidence race: a no-op, the kill landed in the multicall, no kill is sent alone, and the event pipeline stays alive", async function () {
        const h = TestSession.getHarness();
        const staged = await stageSlowAuditorPastEvidencePeriod(h, {
            minimumEstimate: true
        });

        const multicall = await expectSlowAuditorLostRaceNoOp(h, staged);
        expect(multicall.revert?.name).to.equal(
            "RaceConditionDisputeEvidencePeriodExpired"
        );
        const estimates = await staged.bestEffortEstimates!();
        expect(
            estimates.map(({ method, refusal }) => ({ method, refusal }))
        ).to.deep.equal([
            {
                method: "multicall",
                refusal: "RaceConditionDisputeEvidencePeriodExpired"
            },
            { method: "multicallBestEffortLast", refusal: null }
        ]);
    });

    it("a slow auditor's kill and dispute land after the evidence period closed and the upload's refusal carries no revert data → the all-or-nothing estimate's refusal classifies it as the lost evidence race: a no-op, the kill landed in the multicall, no kill is sent alone, and the event pipeline stays alive", async function () {
        const h = TestSession.getHarness();
        const staged = await stageSlowAuditorPastEvidencePeriod(h, {
            refuseUpload: "emptyRevert"
        });

        const multicall = await expectSlowAuditorLostRaceNoOp(h, staged);
        expect(multicall.lastCallRevertData).to.equal("0x");
    });

    it("a slow auditor's kill and dispute land after the evidence period closed and the upload's facet reverts without data, which the proxy reports as its \"Delegatecall failed\" Error(string) → the all-or-nothing estimate's refusal classifies it as the lost evidence race: a no-op, the kill landed in the multicall, no kill is sent alone, and the event pipeline stays alive", async function () {
        const h = TestSession.getHarness();
        const staged = await stageSlowAuditorPastEvidencePeriod(h, {
            refuseUpload: "emptyFacetRevert"
        });

        const multicall = await expectSlowAuditorLostRaceNoOp(h, staged);
        expect(multicall.revert).to.deep.equal({
            name: "Error",
            args: ["StateChannelManagerProxy - Delegatecall failed"]
        });
    });

    it("the upload of a mined kill-and-dispute multicall is refused with a custom error no dispute handler takes (ErrorDisputerNotMsgSender) → the kill landed once in the multicall, the marker rolled back, dispute() rejects with the refusal, and no kill is sent alone", async function () {
        const h = TestSession.getHarness();
        const { forkId, spammer, slow, submissions, applies } =
            await stageRefusedKillAndDispute(h, "unhandledCustomError");

        const outcome = await killAndDisputeSpamDispute(
            h,
            slow.index,
            spammer.address,
            forkId
        );

        expect(outcome.rejected).to.match(/^ErrorDisputerNotMsgSender\b/);
        expect(outcome.disputed).to.equal(false);
        const recorded = await submissions.submissions();
        expect(recorded).to.have.length(1);
        expect(recorded[0]).to.include({
            method: "multicallBestEffortLast",
            waited: true
        });
        expect(recorded[0].innerMethods[0]).to.equal("applyDisputeFraudProofs");
        expect(recorded[0].revert?.name).to.equal("ErrorDisputerNotMsgSender");
        expect(await applies.applies()).to.deep.equal([]);
        // only peer 0's replacement is in the window
        expect(
            await h.channelManager.getWindowCommitments(h.channelId, forkId)
        ).to.have.length(1);
    });

    it("the upload of a mined kill-and-dispute multicall is refused without revert data while its all-or-nothing estimate succeeded → nothing classifies the refusal: the kill landed once in the multicall, the marker rolled back, dispute() rejects, and no kill is sent alone", async function () {
        const h = TestSession.getHarness();
        const { forkId, spammer, slow, submissions, applies } =
            await stageRefusedKillAndDispute(h, "emptyRevert");

        const outcome = await killAndDisputeSpamDispute(
            h,
            slow.index,
            spammer.address,
            forkId
        );

        expect(outcome.rejected).to.equal("dispute upload reverted: 0x");
        expect(outcome.disputed).to.equal(false);
        const recorded = await submissions.submissions();
        expect(recorded).to.have.length(1);
        expect(recorded[0]).to.include({
            method: "multicallBestEffortLast",
            waited: true,
            lastCallRevertData: "0x"
        });
        expect(recorded[0].innerMethods[0]).to.equal("applyDisputeFraudProofs");
        expect(await applies.applies()).to.deep.equal([]);
        expect(
            await h.channelManager.getWindowCommitments(h.channelId, forkId)
        ).to.have.length(1);
    });

    it("a kill lands while a slow auditor's kill and dispute is in flight → the replacement it queues is built and its lone upload, refused because the evidence period closed, is a no-op", async function () {
        const h = TestSession.getHarness();
        await h.scenario.preDisputeSetup({
            peerCount: 4,
            timeConfig: { evidenceTime: EVIDENCE_TIME }
        });
        const forkId = h.activeForkId!;
        for (const peer of h.peers) {
            await h.rpcStub.suppressTimeoutCheck(peer.index);
            await h.rpcStub.holdReductionRace(peer.index);
        }
        const spammer = h.getPeer(1);
        const slow = h.getPeer(2);
        for (const index of [1, 3]) await h.rpcStub.suppressDisputeKill(index);
        const killer = await h.rpcStub.suppressDisputeKill(0);
        const slowSubmissions = await h.rpcStub.recordDisputeSubmissions(
            slow.index,
            { forward: true }
        );
        const slowConstruction =
            await h.rpcStub.holdConstructDisputeAtStateProof(
                slow.index,
                forkId
            );

        await h.tamper.postTamperedDispute(spammer.index, stripDisputeReasons);
        await killer.waitUntilSkipped();
        // the slow auditor found the dispute invalid and builds its own
        await slowConstruction.waitUntilParked();
        const created = Number(
            await h.channelManager.getDisputeWindowCreationTimestamp(
                h.channelId,
                forkId
            )
        );

        // the kill lands alone and empties the window: the slow auditor
        // queues a replacement behind its own kill and dispute
        await killer.restore();
        await killSpamDispute(h, 0, spammer.address, forkId);
        await h.rpcStub.waitUntilDisputeMutexContended(slow.index);
        // another auditor's replacement lands
        await waitFor(
            async () =>
                (
                    await h.channelManager.getWindowCommitments(
                        h.channelId,
                        forkId
                    )
                ).length > 0,
            h.event.protocolEventTimeoutMs()
        );

        // the evidence period is over
        await h.event.waitUntilTimestamp(created + EVIDENCE_TIME + 1);
        await slowConstruction.resume();
        await h.rpcStub.waitUntilDisputeMutexIdle(slow.index);

        // the in-flight kill and dispute and the queued replacement were
        // built; both uploads were refused and neither stopped the node
        expect(await slowConstruction.uploadConstructions()).to.equal(2);
        const [multicall, replacement] = await slowSubmissions.submissions();
        expect(multicall.method).to.equal("multicallBestEffortLast");
        expect(multicall.revert?.name).to.equal(
            "RaceConditionDisputeEvidencePeriodExpired"
        );
        expect(["uploadDispute", "uploadDisputeWithCalldata"]).to.include(
            replacement.method
        );
        expect(replacement.revert?.name).to.equal(
            "RaceConditionDisputeEvidencePeriodExpired"
        );
        expect(
            await h.execOnHost(
                slow,
                (sm, args) => sm.storage.disputes.didIDispute(args.forkId),
                { forkId }
            )
        ).to.equal(false);
        expect(await eventPipelineOutcome(h, slow.index)).to.deep.equal({
            failedBlocks: 0,
            isDisposed: false
        });
    });
});
