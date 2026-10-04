import { Status } from "@/types";
import { DisputeFraudProofType } from "@/types/sol-enums";
import { clientRootFor } from "@test/fixtures/RuntimeRootObservation";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

// The dispute's `outputSnapshotDataHash` commits to the post-reduction state
// snapshot. The validator recomputes this hash from the verified state proof +
// dispute input and rejects mismatches. See also disputeInputFields/selfRemoval.test.ts
// for the selfRemoval-flipped variant (which also fails via DisputeInvalidOutputState).

describe("E2E: dispute validation / outputState", function () {
    it("dispute.outputSnapshotDataHash = random → DisputeInvalidOutputState", async function () {
        const h = TestSession.getHarness();
        await h.scenario.preDisputeSetup();
        const forkId = h.activeForkId!;

        await h.tamper.stubConstructDispute(2, async (dispute, sm) => {
            dispute.outputSnapshotDataHash =
                sm.p2pManager.localRpc.dispute.hash("0x42");
        });

        await h.byzantine.submitDoubleSignBlock(1);

        await h.assert.dispute.initiatedAndCommitedWait({
            peersIndices: [2],
            initiatedWithAuditingData: false
        });

        await h.event.waitForPeers("onDisputeKilled", [0], 1, {
            mode: "atLeast"
        });
        await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
            disputeFraudProofType:
                DisputeFraudProofType.DisputeInvalidOutputState
        });
        await h.dispute.resolveDisputeWait({ forkId });
    });

    it("a spectator does not audit: a non-final dispute (outputSnapshotDataHash = random) → the spectator aborts its runtime instead of auditing; the participants store DisputeInvalidOutputState, kill it and resolve the window", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 0);
        const { peer: spectator } = await h.join.addSpectatorAuthoring({
            authoringPeerIndices: [0, 1, 2],
            minimumBlocks: 2,
            maximumBlocks: 20
        });
        await h.assert.sync.peersInSyncWait();
        const forkId = h.activeForkId!;
        const host = clientRootFor(
            spectator.p2pInstance
        ).p2pRuntimeHostRemoteRoot!;

        await h.tamper.stubConstructDispute(0, async (dispute, sm) => {
            dispute.outputSnapshotDataHash =
                sm.p2pManager.localRpc.dispute.hash("0x42");
        });
        // no fraudulent block: the spectator sees only the posted dispute.
        // A self-removal states a reason, so the dispute opens the window
        // itself instead of requiring an existing one
        await h.control(h.getPeer(0)).dispute.setForceExit(true).request();
        await h.rpcStub.restoreDisputeInitiationAndDispute(0, forkId);

        await waitFor(() => host.isClosed, h.event.protocolEventTimeoutMs());
        expect(
            (spectator.eventSpies.onStatusChanged?.getCalls() ?? []).map(
                (call) => call.args[1] as Status
            ),
            "the spectator drops to OPENED"
        ).to.include(Status.OPENED);

        await h.event.waitForPeers("onDisputeKilled", [1, 2], 1, {
            mode: "atLeast"
        });
        await h.assert.storage.honestPeersStoredDisputeFraudProofWait({
            disputeFraudProofType:
                DisputeFraudProofType.DisputeInvalidOutputState,
            peerIndices: [1, 2]
        });
        // the kill empties the window: the honest participants upload
        // replacement evidence on their own and reduce without the spectator
        await h.dispute.resolveDisputeWait({
            forkId,
            honestPeerIndices: [1, 2]
        });
    });

    it("a spectator does not follow a final dispute: its first dispute event is threshold-final → the spectator aborts its runtime instead of storing it or adopting its outcome; the participants install the reduced fork", async function () {
        const h = TestSession.getHarness();
        await h.scenario.preDisputeSetup({
            peerCount: 4,
            timeConfig: { evidenceTime: 3 }
        });
        const { peer: spectator } = await h.join.addSpectatorAuthoring({
            authoringPeerIndices: [0, 1, 2, 3],
            minimumBlocks: 2,
            maximumBlocks: 20
        });
        await h.assert.sync.peersInSyncWait();
        const host = clientRootFor(
            spectator.p2pInstance
        ).p2pRuntimeHostRemoteRoot!;

        // honest peers open no ordinary dispute: the final dispute is the
        // first dispute event the spectator sees
        const staged = await h.dispute.submitFinalDispute({
            maliciousPeerIndex: 1,
            finalAuthorPeerIndex: 3
        });

        await waitFor(() => host.isClosed, h.event.protocolEventTimeoutMs());
        expect(
            (spectator.eventSpies.onStatusChanged?.getCalls() ?? []).map(
                (call) => call.args[1] as Status
            ),
            "the spectator drops to OPENED"
        ).to.include(Status.OPENED);
        await h.assert.dispute.reductionCompletedWait({
            sourceForkId: staged.forkId,
            reducedForkId: staged.finalResolution.forkId,
            peerIndices: [0, 2, 3]
        });
    });
});
