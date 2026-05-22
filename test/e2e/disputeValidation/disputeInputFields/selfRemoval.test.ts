import { DisputeFraudProofType } from "@/types/sol-enums";
import { addressesEqual } from "@/utils";
import {
    DisputeTampering,
    MathTestSession as TestSession
} from "@test/harness";
import { expect } from "chai";

describe("E2E: dispute validation / disputeInputFields / selfRemoval", function () {
    it("dispute.input.selfRemoval = true; honest disputer voluntarily exits → dispute commits and disputer removed from participant set", async function () {
        const h = TestSession.getHarness();
        // Larger agreementTime avoids writer-timeout disputes racing self-removal.
        await h.scenario.preDisputeSetup({
            timeConfig: { agreementTime: 8, evidenceTime: 4 }
        });

        const leaverIndex = 1;
        const leaverAddress = h.getPeer(leaverIndex).address;

        // forceExit yields a valid self-removal dispute; post untampered.
        h.getPeer(leaverIndex).stateManager.storage.forceExit.setForceExit(
            true
        );
        // Voluntary exit: skip sync barrier, don't mark malicious.
        h.context.leftChannelPeerIndices = [
            ...h.context.leftChannelPeerIndices,
            leaverIndex
        ];

        await h.tamper.postTamperedDispute(leaverIndex, () => {}, {
            markMalicious: false
        });

        const remainingPeerIndices = h
            .getPeersExcludingMaliciousAndLeavers()
            .map((p) => p.index);

        // One dispute commits on-chain.
        await h.assert.dispute.committedWait({
            peersIndices: remainingPeerIndices,
            expectedCount: 1
        });

        // Nobody should kill a valid self-removal dispute.
        await h.event.waitWhileEventCountsStayAtMost(
            "onDisputeKilled",
            [...remainingPeerIndices, leaverIndex],
            { durationMs: 4000 }
        );

        await h.dispute.resolveDisputeWait({
            assertMaliciousRemoved: false,
            honestPeerIndices: remainingPeerIndices
        });

        await h.assert.sync.participantCount({ expectedCount: 2 });

        for (const peer of h.getPeersExcludingMaliciousAndLeavers()) {
            const participants =
                await peer.stateManager.diamondStateMachine.getParticipants();
            expect(
                participants.some((p) => addressesEqual(p, leaverAddress)),
                `Peer ${peer.index} still has self-removed peer ${leaverIndex} in participants`
            ).to.equal(false);
        }
    });

    it("dispute.input.selfRemoval flipped without recomputing outputSnapshotDataHash → DisputeInvalidOutputState", async function () {
        const h = TestSession.getHarness();
        await h.scenario.preDisputeSetup({
            timeConfig: { evidenceTime: 6 }
        });

        // Tamper helper flipSelfRemovalWithoutOutputRecompute flips
        // selfRemoval=!selfRemoval and zeroes timeout/onChainSlashes, but does
        // NOT recompute the outputSnapshotDataHash — so the on-chain validator
        // finds the output hash disagrees with the (now inconsistent)
        // selfRemoval flag.
        await h.tamper.postTamperedDispute(1, (dispute) => {
            DisputeTampering.flipSelfRemovalWithoutOutputRecompute(dispute);
        });

        await h.event.waitForAllPeers("onDisputeKilled", 1, {
            mode: "atLeast"
        });
        await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
            disputeFraudProofType:
                DisputeFraudProofType.DisputeInvalidOutputState,
            timeoutMs: 10000
        });
        await h.dispute.resolveDisputeWait({ forkSettleTimeoutMs: 15000 });
    });
});
