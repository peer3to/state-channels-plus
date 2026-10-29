import { DisputeFraudProofType } from "@/types/sol-enums";
import { Bytes, Hash } from "@/types/types";
import { Codec, Type } from "@/utils";
import {
    DisputeTampering,
    MathTestSession as TestSession
} from "@test/harness";
import { expect } from "chai";

// upload refuses any anchor other than the chain's inbound head (disputeValidation/uploadRevert/latestInboundMessageBlockHash.test.ts),
// so the junk and behind anchors below never reach a committed dispute to prove

describe("E2E: dispute validation / inboundHash", function () {
    it.skip("dispute.input.latestInboundMessageBlockHash = random (not on-chain) → DisputeInboundHashNotInChain", async function () {
        const h = TestSession.getHarness();
        await h.scenario.preDisputeSetup();
        const forkId = h.activeForkId!;

        // Construct the honest replacement after the kill's slash is observed.
        // A pre-kill output can finalize against the smaller post-kill threshold.
        await h.dispute.suppressDisputeInitiation([h.getPeer(2).index]);

        await h.tamper.stubConstructDispute(0, (dispute, sm) => {
            dispute.input.latestInboundMessageBlockHash =
                sm.p2pManager.localRpc.dispute.randomHash() as Hash;
        });

        await h.byzantine.submitDoubleSignBlock(1);

        await h.assert.dispute.initiatedAndCommitedWait({
            peersIndices: [0],
            initiatedWithAuditingData: false
        });
        await h.event.waitForPeers("onDisputeKilled", [0, 2], 1, {
            mode: "atLeast"
        });
        await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
            disputeFraudProofType:
                DisputeFraudProofType.DisputeInboundHashNotInChain
        });
        await h.rpcStub.restoreDisputeInitiationAndDispute(2, forkId);
        await h.dispute.resolveDisputeWait({ forkId });
    });

    it.skip("dispute.input.latestInboundMessageBlockHash = ZeroHash AND lastInboundMessageBlockHeight > 0 → DisputeInboundHashNotInChain", async function () {
        const h = TestSession.getHarness();
        await h.scenario.preDisputeSetup();
        const forkId = h.activeForkId!;

        // Keep the same kill-before-replacement ordering as the random-hash case.
        await h.dispute.suppressDisputeInitiation([h.getPeer(2).index]);

        await h.tamper.stubConstructDispute(0, (dispute, sm) => {
            dispute.input.latestInboundMessageBlockHash = sm.p2pManager.localRpc
                .dispute.zeroHash as Hash;
            dispute.input.lastInboundMessageBlockHeight = 999999n;
        });

        await h.byzantine.submitDoubleSignBlock(1);

        await h.assert.dispute.initiatedAndCommitedWait({
            peersIndices: [0],
            initiatedWithAuditingData: false
        });
        await h.event.waitForPeers("onDisputeKilled", [0, 2], 1, {
            mode: "atLeast"
        });
        await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
            disputeFraudProofType:
                DisputeFraudProofType.DisputeInboundHashNotInChain
        });
        await h.rpcStub.restoreDisputeInitiationAndDispute(2, forkId);
        await h.dispute.resolveDisputeWait({ forkId });
    });

    // an anchor at the head is behind the pinned state only if signers signed inbound the chain doesn't hold
    it.skip("dispute.input.lastInboundMessageBlockHeight below the pinned snapshotData.latestInboundMessageBlockHeight → DisputeInboundAnchorBehindLatestState", async function () {
        const h = TestSession.getHarness();
        const attackerIndex = 1;
        // larger agreementTime avoids writer-timeout disputes racing the upload
        await h.scenario.preDisputeSetupConsumedInboundTopUp({
            timeConfig: { agreementTime: 8, evidenceTime: 8 }
        });
        const forkId = h.activeForkId!;

        const attacker = h.control(h.getPeer(attackerIndex));
        const headHash = (await attacker.query
            .getLatestInboundMessageHash()
            .request()) as Hash;
        const headHeight = (await attacker.query
            .getInboundLatestHeight()
            .request())!;
        const head = Codec.decode(
            (await attacker.query.getInboundMessageBlock(headHash).request())!
                .encodedMessageBlock,
            Type.MessageBlock
        );
        const previousHash = head.previousBlockHash as Hash;
        const previousHeight = headHeight - 1;
        // premise - an earlier inbound block really exists to name
        expect(previousHeight).to.be.greaterThan(0);

        // selfRemoval gives the dispute a stated reason, so the audit gets past
        // hasDisputeReason and reaches the output verification
        const { disputeConfirmation } = await h.tamper.postTamperedDispute(
            attackerIndex,
            (dispute) => {
                DisputeTampering.flipSelfRemovalWithoutOutputRecompute(dispute);
                dispute.input.latestInboundMessageBlockHash = previousHash;
                dispute.input.lastInboundMessageBlockHeight = previousHeight;
            }
        );

        const encodedDispute = disputeConfirmation.signedDispute
            .encodedDispute as Bytes;

        // premise - the snapshot the dispute pins via latestStateSnapshotHash
        // is already past the height the dispute names
        const committed = Codec.decode(encodedDispute, Type.Dispute);
        const latestSnapshot = await h
            .control(h.getPeer(0))
            .query.getStateSnapshotStructByHash(
                committed.input.latestStateSnapshotHash as Hash
            )
            .request();
        expect(
            Number(
                Codec.decode(
                    latestSnapshot!.encodedSnapshot,
                    Type.StateSnapshot
                ).snapshotData.latestInboundMessageBlockHeight
            )
        ).to.equal(headHeight);

        // premise - the chain accepted and committed the tampered dispute (the
        // only one in this scenario), so honest auditors meet this shape live.
        // edge-triggered: the kill clears the window commitment and the stored
        // confirmation as soon as an auditor wins the race
        await h.assert.dispute.committedWait({ expectedCount: 1 });

        await h.event.waitForAllPeers("onDisputeKilled", 1, {
            mode: "atLeast"
        });
        await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
            disputeFraudProofType:
                DisputeFraudProofType.DisputeInboundAnchorBehindLatestState
        });
        await h.dispute.resolveDisputeWait({ forkId });
    });

    // the false-slash tripwire for the proof above: an honest peer whose
    // InboundMessagesProcessed event lags anchors on the snapshot it pins, so
    // its own dispute is never provable fraud
    it("honest disputer whose inbound chain event lags → dispute survives, disputer not killed or slashed", async function () {
        const h = TestSession.getHarness();
        const laggingIndex = 2;
        const attackerIndex = 1;

        // larger agreementTime avoids writer-timeout disputes racing the upload
        await h.setup(3, {
            timeConfig: {
                p2pTime: 2,
                agreementTime: 8,
                chainFallbackTime: 4,
                evidenceTime: 4
            }
        });
        // held from before the channel opens -> the lagging peer never stores
        // inbound block 1, so its inbound store head can never move
        await h.rpcStub.holdInboundMessageEvents(laggingIndex);
        await h.lifecycle.openChannel();
        const forkId = h.activeForkId!;
        await h.transition.advanceState({
            count: 2,
            waitForFinalization: true
        });
        // topping up an existing participant keeps block turns intact
        await h.join.forceInboundJoinWait({
            participant: h.getPeer(0).address,
            observePeerIndices: [0, 1]
        });
        await h.transition.advanceState({
            count: 2,
            waitForFinalization: true
        });
        await h.assert.sync.peersInSyncWait();
        h.event.resetEventSpies();
        h.contextApi.captureOriginalFork();

        // peer 0 never initiates -> the committed dispute is the lagging
        // peer's, while peer 0 still audits and kills for real
        await h.dispute.suppressDisputeInitiation([h.getPeer(0).index]);

        await h.byzantine.submitDoubleSignBlock(attackerIndex);

        await h.assert.dispute.initiatedAndCommitedWait({
            peersIndices: [laggingIndex],
            expectedCount: 1
        });
        await h.dispute.resolveDisputeWait({ forkId });

        // no auditor found fraud in the honest disputer's anchor
        for (const peer of h.peers) {
            expect(
                h.event.getEventCallCount(peer.index, "onDisputeKilled"),
                `peer ${peer.index} onDisputeKilled`
            ).to.equal(0);
        }
        // resolveDisputeWait already pins the new fork to the honest peers ->
        // the double-signer is out and the disputer is still in
        const slashed = await h.channelManager.getOnChainSlashedParticipants(
            h.channelId
        );
        expect(slashed).to.not.include(h.getPeer(laggingIndex).address);
    });
});
