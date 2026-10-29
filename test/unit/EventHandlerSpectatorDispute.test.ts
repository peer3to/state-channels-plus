import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";

// only participants and pending participants audit a committed dispute
// (data availability is guaranteed to them alone). A spectator persists the
// window and schedules its reduction without auditing.

describe("Unit: EventHandler committed dispute on a spectator", function () {
    it("a spectator does not audit a committed dispute: no audit read, no dispute fraud proof, and it later reduces; a participant audits the same dispute", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 1);
        const participants = [0, 1, 2];
        // no transition is scheduled while the spectator syncs
        const spectatorIndex = (await h.join.addSpectatorWait()).index;
        await h.assert.sync.peersInSyncWait({
            peerIndices: [...participants, spectatorIndex]
        });
        const forkId = h.activeForkId!;
        const offenderIndex = (await h.query.getNextPeerToWrite()).index;
        const observerIndex = participants.find(
            (index) => index !== offenderIndex
        )!;
        // the invalid block would reach the spectator by gossip, and a
        // spectator drops the feed on it; it follows the dispute from chain
        // events only
        await h.network.blacklistAndDisconnectPeer(spectatorIndex);
        // the audit's first chain-backed check (DisputeValidationService)
        const spectatorAudit = await h.mirror.observe(
            spectatorIndex,
            "isDisputeInboundHashValid"
        );
        const observerAudit = await h.mirror.observe(
            observerIndex,
            "isDisputeInboundHashValid"
        );

        await h.byzantine.submitInvalidStateTransitionBlock(offenderIndex);
        await h.assert.dispute.committedWait({
            peersIndices: [spectatorIndex, observerIndex],
            expectedCount: 1
        });
        await h.assert.sync.forkChangedWait({
            originalForkId: forkId,
            honestPeerIndices: [spectatorIndex, observerIndex]
        });
        const spectatorReads = await spectatorAudit.observation();
        const observerReads = await observerAudit.observation();
        await spectatorAudit.restore();
        await observerAudit.restore();

        expect(spectatorReads.local.reads).to.equal(0);
        expect(spectatorReads.chain.reads).to.equal(0);
        expect(
            await h
                .control(h.getPeer(spectatorIndex))
                .query.getDisputeFraudProofTypes()
                .request()
        ).to.deep.equal([]);
        // control: the participant audited the same dispute
        expect(
            observerReads.local.reads + observerReads.chain.reads
        ).to.be.greaterThan(0);
    });
});
