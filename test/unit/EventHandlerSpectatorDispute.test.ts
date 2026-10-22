import { Status } from "@/types";
import { runtimeIsClosed } from "@test/fixtures/RuntimeRootObservation";
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
    it("a spectator behind a threshold-final dispute's latest block defers its genesis instead of aborting, stays SYNCED and reaches the dispute's output fork", async function () {
        const h = TestSession.getHarness();
        await h.scenario.preDisputeSetup({
            peerCount: 4,
            timeConfig: { evidenceTime: 3 }
        });
        const participants = h.peers.map((peer) => peer.index);
        const maliciousPeerIndex = 1;
        const honest = participants.filter(
            (index) => index !== maliciousPeerIndex
        );
        const spectatorIndex = (
            await h.join.addSpectatorAuthoring({
                authoringPeerIndices: participants,
                minimumBlocks: 1,
                maximumBlocks: 20
            })
        ).peer.index;
        const spectator = h.getPeer(spectatorIndex);
        // cut off -> the participants' next final block never reaches it, and
        // it follows the dispute from chain events only
        await h.network.blacklistAndDisconnectPeer(spectatorIndex);
        await h.transition.advanceState({
            count: 1,
            waitForPeers: participants,
            waitForFinalization: true
        });
        const forkId = h.activeForkId!;
        const heightOn = async (index: number) =>
            Number(
                (await h
                    .control(h.getPeer(index))
                    .query.getLatestBlockHeight(forkId)
                    .request()) ?? -1
            );
        // premise - the final point the dispute pins is above the spectator
        expect(await heightOn(honest[0]!)).to.be.greaterThan(
            await heightOn(spectatorIndex)
        );

        const staged = await h.dispute.submitFinalDispute({
            maliciousPeerIndex,
            finalAuthorPeerIndex: honest[honest.length - 1]!
        });
        // the hook fires after the spectator's handler completed
        await h.assert.dispute.committedWait({
            peersIndices: [spectatorIndex],
            expectedCount: 1
        });
        expect(runtimeIsClosed(spectator.p2pInstance)).to.equal(false);
        expect(await h.control(spectator).query.getStatus().request()).to.equal(
            Status.SYNCED
        );
        expect((await h.peerForkIds([spectator]))[0]).to.equal(forkId);

        await h.dispute.resolveFinalDispute(staged, {
            honestPeerIndices: honest
        });
        const outputForkId = staged.finalResolution.forkId;
        await h.network.restorePeerDiscovery([spectatorIndex]);
        await h.transition.keepAuthoringUntil({
            until: async () =>
                (await h.peerForkIds([spectator]))[0] === outputForkId,
            waitForPeers: honest,
            maximumBlocks: 10
        });
        expect(runtimeIsClosed(spectator.p2pInstance)).to.equal(false);
        expect(await h.control(spectator).query.getStatus().request()).to.equal(
            Status.SYNCED
        );
    });
});
