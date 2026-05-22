import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";
import { Status } from "@/types";
import { Codec, Type, hash } from "@/utils";

/**
 * E2E Tests for Participant Lifecycle (Exit + Join)
 *
 * Maps to:
 *   src/stateManager/StateManager.ts  (startMaybeExitOnChain, joinChannel)
 *   src/eventHandlers/EventHandler.ts (onStateSnapshotUpdated status transitions)
 *   src/evm/P2pSigner.ts              (joinChannel public API)
 *
 * Covers:
 *   1. Exit path  — leaveChannel() → N/N snapshot after agreementTime (+ P2P signature window) →
 *                   exiter awaits receipt and becomes SYNCED; peers observe onStateSnapshotUpdated
 *   2. Join path  — PENDING_PARTICIPANT on broadcast; once the first block whose
 *                   resulting snapshot includes the joiner is processed (success()),
 *                   the joiner is promoted to PARTICIPATING and starts signing.
 */
describe("E2E: Participant Lifecycle", function () {
    describe("Exit path", function () {
        it("should demote exiting participant to SYNCED when state snapshot is updated on-chain", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);

            const leaverIndex = await h.transition.participantLeaveWait();
            expect(leaverIndex).to.equal(
                2,
                "expected peer 2 to leave given start(3,2) turn order"
            );

            // Remaining participants are unaffected
            const remaining = h.peers.filter((p) => p.index !== leaverIndex);
            for (const p of remaining) {
                expect(p.stateManager.getStatus()).to.equal(
                    Status.PARTICIPATING,
                    `Peer ${p.index} should remain PARTICIPATING`
                );
            }
        });
    });

    describe("Join path", function () {
        it("should set PENDING_PARTICIPANT on join broadcast, then PARTICIPATING once joiner appears in a block", async function () {
            const h = TestSession.getHarness();

            await h.lifecycle.start(2);

            const spectator = await h.join.addSpectatorWait({
                statusTimeoutMs: 5000,
                statusTimeoutMessage: "Spectator did not reach SYNCED status"
            });
            await h.assert.sync.peersInSyncWait({ peerIndices: [0, 1, 2] });

            const stateSnapshot = await h.channelManager.getStateSnapshot(
                h.channelId
            );
            const confirmation = await h.join.buildJoinChannelConfirmation({
                joiner: spectator,
                channelId: h.channelId,
                existingParticipantSigners: [
                    h.peers[0].signer,
                    h.peers[1].signer
                ]
            });
            const expectedSnapshotHash = hash(
                Codec.encode(stateSnapshot, Type.StateSnapshot)
            );

            // Fire joinChannel WITHOUT awaiting — the synchronous portion of
            // StateManager.joinChannel() calls setStatus(PENDING_PARTICIPANT)
            // before the first `await`, so the promotion is observable
            // immediately after the call starts.
            const joinPromise = spectator.p2pInstance.p2pSigner.joinChannel(
                confirmation,
                expectedSnapshotHash
            );

            // Status must already be PENDING_PARTICIPANT — no await needed
            expect(spectator.stateManager.getStatus()).to.equal(
                Status.PENDING_PARTICIPANT,
                "Status should be PENDING_PARTICIPANT immediately on broadcast, before tx is mined"
            );

            // Wait for the tx to land on-chain
            await joinPromise;

            // Ensure all honest peers have stored the inbound message before
            // the block producer runs, so the join is included in the block
            await h.assert.storage.honestPeersObserveInboundMessageWait();

            await h.transition.advanceState({ count: 1 });

            // Joiner is now PARTICIPATING — promoted inside success() when the first
            // block that includes them in the resulting participant set was processed.
            expect(spectator.stateManager.getStatus()).to.equal(
                Status.PARTICIPATING,
                "Joiner should be PARTICIPATING after the first block that includes them"
            );
        });
    });
});
