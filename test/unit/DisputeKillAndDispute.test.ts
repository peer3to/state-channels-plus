import { DisputeFraudProofType } from "@/types/sol-enums";
import { Codec, hash, Type } from "@/utils";
import {
    stageReasonlessInitialDispute,
    waitUntilAuditsSettled
} from "@test/fixtures/DisputeAuditStaging";
import { waitForCommittedDisputeOf } from "@test/fixtures/EvidenceComparisonStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";

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
        expect(submission.method).to.equal("multicall");
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
});
