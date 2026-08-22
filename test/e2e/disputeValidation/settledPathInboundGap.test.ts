import { expect } from "chai";

import { Status } from "@/types";
import { Hash } from "@/types/types";
import { MathTestSession as TestSession } from "@test/harness";
import { DisputeTampering } from "@test/harness/actions/DisputeTamperingActions";

// On the settled path (postedAuditingData = false) the disputer posts no
// auditing data, so every auditor rebuilds it from its own inbound store. An
// auditor missing the inbound block the dispute names used to walk into the gap:
// getAuditingData -> MessageBlockStorage threw, the throw escaped
// onDisputeCommitted, EventSyncService cached the rejected log forever, and
// every later reduce replayed it into abort(). The audit now recovers the log
// on demand, and a gap that survives recovery is an abstain, never a throw.

describe("E2E: dispute validation / inbound run gap", function () {
    const TIME_CONFIG = {
        p2pTime: 2,
        agreementTime: 8,
        chainFallbackTime: 4,
        evidenceTime: 4
    };

    /**
     * 3 peers, two finalized transitions, then a top-up of an existing
     * participant: block turns and the final-by-everyone head stay intact, so
     * disputes take the settled path, and the chain's inbound head ends up above
     * the snapshot every dispute pins. Returns the head the disputes will name.
     */
    const stageInboundGap = async (
        h: ReturnType<typeof TestSession.getHarness>,
        laggingIndex: number,
        observePeerIndices: number[]
    ): Promise<Hash> => {
        await h.join.forceInboundJoinWait({
            participant: h.getPeer(observePeerIndices[0]).address,
            observePeerIndices
        });

        const inboundHeadHash = (await h
            .control(h.getPeer(observePeerIndices[0]))
            .query.getLatestInboundMessageHash()
            .request()) as Hash;
        // premise - the lagging peer holds no block at the inbound head the
        // other peers' disputes name
        expect(
            await h
                .control(h.getPeer(laggingIndex))
                .query.getInboundMessageBlock(inboundHeadHash)
                .request(),
            "lagging peer must not hold the inbound head"
        ).to.equal(null);
        return inboundHeadHash;
    };

    /** No peer may answer a gap with a fraud proof - it is nobody's fraud. */
    const expectNoDisputeFraudProofs = async (
        h: ReturnType<typeof TestSession.getHarness>
    ): Promise<void> => {
        for (const peer of h.peers) {
            expect(
                await h
                    .control(peer)
                    .query.getDisputeFraudProofTypes()
                    .request(),
                `peer ${peer.index} must store no dispute fraud proof`
            ).to.deep.equal([]);
        }
    };

    it("recoverable inbound log → the auditor recovers it, audits for real and converges", async function () {
        const h = TestSession.getHarness();
        await h.setup(3, { timeConfig: TIME_CONFIG });
        await h.lifecycle.openChannel();
        const forkId = h.activeForkId!;
        await h.transition.advanceState({
            count: 2,
            waitForFinalization: true
        });
        await h.assert.sync.peersInSyncWait();

        const offenderIndex = (await h.query.getNextPeerToWrite()).index;
        const [disputerIndex, laggingIndex] = h.peers
            .map((peer) => peer.index)
            .filter((index) => index !== offenderIndex);

        // the delivery is lost, not the handler: an explicit query of the same
        // log still applies it, so on-demand recovery can heal this gap
        const dropped = await h.rpcStub.dropInboundMessageLogs(laggingIndex);
        const inboundHeadHash = await stageInboundGap(h, laggingIndex, [
            disputerIndex,
            offenderIndex
        ]);
        await dropped.waitUntilDropped();

        h.event.resetEventSpies();
        h.contextApi.captureOriginalFork();

        await h.byzantine.submitInvalidStateTransitionBlock(offenderIndex);

        // premise - a settled-path dispute is committed, and the lagging peer
        // audits it
        await h.assert.dispute.initiatedAndCommitedWait({
            peersIndices: [disputerIndex],
            expectedCount: 1,
            initiatedWithAuditingData: false
        });

        // the disputed fork resolves for everyone, the lagging peer included
        await h.assert.sync.forkChangedWait({
            originalForkId: forkId,
            honestPeerIndices: [disputerIndex, laggingIndex]
        });

        // the audit recovered the missing log instead of throwing on it
        expect(
            await h
                .control(h.getPeer(laggingIndex))
                .query.getInboundMessageBlock(inboundHeadHash)
                .request(),
            "lagging peer must hold the recovered inbound head"
        ).to.not.equal(null);
        expect(
            await h
                .control(h.getPeer(laggingIndex))
                .query.getStatus()
                .request(),
            "lagging peer must still be participating"
        ).to.equal(Status.PARTICIPATING);
        await expectNoDisputeFraudProofs(h);
        expect(
            await TestSession.consumeFirstDetachedError(
                h.event.protocolEventTimeoutMs()
            )
        ).to.equal(undefined);

        await dropped.release();
    });

    it("unrecoverable inbound log → the auditor abstains, stays participating, converges once the event lands", async function () {
        const h = TestSession.getHarness();
        await h.setup(3, { timeConfig: TIME_CONFIG });
        await h.lifecycle.openChannel();
        const forkId = h.activeForkId!;
        await h.transition.advanceState({
            count: 2,
            waitForFinalization: true
        });
        await h.assert.sync.peersInSyncWait();

        const offenderIndex = (await h.query.getNextPeerToWrite()).index;
        const [disputerIndex, laggingIndex] = h.peers
            .map((peer) => peer.index)
            .filter((index) => index !== offenderIndex);

        // the handler itself is held, so recovery re-dispatches into the same
        // hold and cannot heal the gap -> the audit must abstain
        const held = await h.rpcStub.holdInboundMessageEvents(laggingIndex);
        await stageInboundGap(h, laggingIndex, [disputerIndex, offenderIndex]);

        h.event.resetEventSpies();
        h.contextApi.captureOriginalFork();

        await h.byzantine.submitInvalidStateTransitionBlock(offenderIndex);

        await h.assert.dispute.initiatedAndCommitedWait({
            peersIndices: [disputerIndex],
            expectedCount: 1,
            initiatedWithAuditingData: false
        });

        // the healthy auditor reduces the disputed fork
        await h.assert.sync.forkChangedWait({
            originalForkId: forkId,
            honestPeerIndices: [disputerIndex]
        });

        // nothing threw, and abstaining is not an accusation
        expect(
            await TestSession.consumeFirstDetachedError(
                h.event.protocolEventTimeoutMs()
            )
        ).to.equal(undefined);
        await expectNoDisputeFraudProofs(h);

        // an inbound gap it cannot help having must not have evicted it
        expect(
            await h
                .control(h.getPeer(laggingIndex))
                .query.getStatus()
                .request(),
            "lagging peer must still be participating"
        ).to.equal(Status.PARTICIPATING);

        // the missing chain event lands - the peer now holds the whole inbound
        // chain again and reduces on its own
        await held.release();

        await h.assert.sync.forkChangedWait({
            originalForkId: forkId,
            honestPeerIndices: [laggingIndex]
        });
    });

    it("final dispute over an unrecoverable gap → reduction deferred, then settles on the final dispute's fork", async function () {
        const h = TestSession.getHarness();
        await h.setup(3, { timeConfig: TIME_CONFIG });
        await h.lifecycle.openChannel();
        const forkId = h.activeForkId!;
        await h.transition.advanceState({
            count: 2,
            waitForFinalization: true
        });
        await h.assert.sync.peersInSyncWait();

        // the double-signer has to be the author of the head block - the
        // conflicting copy carries that author's coordinates
        const latestBlock = await h
            .control(h.getPeer(0))
            .query.getLatestBlockInfo(forkId)
            .request();
        const maliciousPeerIndex = h.peers.find(
            (peer) => peer.address === latestBlock!.author
        )!.index;
        const [finalAuthorIndex, laggingIndex] = h.peers
            .map((peer) => peer.index)
            .filter((index) => index !== maliciousPeerIndex);

        const held = await h.rpcStub.holdInboundMessageEvents(laggingIndex);
        await stageInboundGap(h, laggingIndex, [
            finalAuthorIndex,
            maliciousPeerIndex
        ]);

        h.event.resetEventSpies();
        h.contextApi.captureOriginalFork();

        // a threshold-final dispute drives the final-genesis branch on the
        // lagging peer, which used to rethrow on a partial rebuild
        const submitted = await h.dispute.submitFinalDispute({
            maliciousPeerIndex,
            finalAuthorPeerIndex: finalAuthorIndex
        });

        await h.assert.sync.forkChangedWait({
            originalForkId: forkId,
            honestPeerIndices: [finalAuthorIndex]
        });

        expect(
            await TestSession.consumeFirstDetachedError(
                h.event.protocolEventTimeoutMs()
            )
        ).to.equal(undefined);
        expect(
            await h
                .control(h.getPeer(laggingIndex))
                .query.getStatus()
                .request(),
            "lagging peer must still be participating"
        ).to.equal(Status.PARTICIPATING);

        await held.release();

        await h.assert.sync.forkChangedWait({
            originalForkId: forkId,
            honestPeerIndices: [laggingIndex]
        });

        // the deferred reduce must derive the final dispute's own output, not
        // some other fork - otherwise the attempt stands down as superseded and
        // never installs anything
        expect(
            await h
                .control(h.getPeer(laggingIndex))
                .query.getForkId()
                .request(),
            "the deferred reduction must settle on the final dispute's fork"
        ).to.equal(submitted.finalResolution.forkId);
    });

    it("posted auditing data with an emptied inbound run → the auditor still rebuilds locally, nobody is slashed", async function () {
        const h = TestSession.getHarness();
        const attackerIndex = 0;
        const laggingIndex = 1;

        // a pending inbound join leaves the head not-final-by-everyone, so a
        // dispute has to post its auditing data - and the held peer never
        // stores the inbound head that dispute names
        const { releaseLaggingInbound } =
            await h.scenario.preDisputeSetupCalldataPath({
                laggingInboundPeerIndex: laggingIndex
            });
        const forkId = h.activeForkId!;

        const inboundHeadHash = (await h
            .control(h.getPeer(attackerIndex))
            .query.getLatestInboundMessageHash()
            .request()) as Hash;
        // premise - the auditor holds no block at the head the dispute names
        expect(
            await h
                .control(h.getPeer(laggingIndex))
                .query.getInboundMessageBlock(inboundHeadHash)
                .request(),
            "lagging peer must not hold the inbound head"
        ).to.equal(null);

        const { dispute } = await h.tamper.postTamperedDispute(
            attackerIndex,
            DisputeTampering.emptyPostedInboundRun
        );
        expect(dispute.postedAuditingData).to.equal(true);

        await h.assert.dispute.committedWait({ expectedCount: 1 });

        // the truncated posted run is harmless: the auditor verifies the output
        // against its own rebuild, so the honest verdict is unaffected and the
        // gap accuses nobody
        expect(
            await TestSession.consumeFirstDetachedError(
                h.event.protocolEventTimeoutMs()
            )
        ).to.equal(undefined);
        await expectNoDisputeFraudProofs(h);
        expect(
            await h
                .control(h.getPeer(laggingIndex))
                .query.getStatus()
                .request(),
            "lagging peer must still be participating"
        ).to.equal(Status.PARTICIPATING);

        await releaseLaggingInbound?.();

        // every peer that is not the attacker converges on the reduced fork
        await h.assert.sync.forkChangedWait({
            originalForkId: forkId,
            honestPeerIndices: [laggingIndex, 2, 3]
        });
    });
});
