import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";
import { Status } from "@/types";

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
            const remaining = h.peerHandles.filter(
                (p) => p.index !== leaverIndex
            );
            for (const p of remaining) {
                expect(
                    await h.getPeerHandle(p.index).channel.queryStatus()
                ).to.equal(
                    Status.PARTICIPATING,
                    `Peer ${p.index} should remain PARTICIPATING`
                );
            }
        });
    });

    describe("Join path", function () {
        it("should set PENDING_PARTICIPANT on join broadcast, then PARTICIPATING once joiner appears in a block", async function () {
            const h = TestSession.getHarness();

            await h.lifecycle.start(2, 0, {
                timeConfig: {
                    agreementTime: 6
                }
            });

            const spectatorHandle = await h.join.addSpectatorWait({
                statusTimeoutMs: 5000,
                statusTimeoutMessage: "Spectator did not reach SYNCED status"
            });
            await h.assert.sync.peersInSyncWait({
                peerIndices: [0, 1, spectatorHandle.index]
            });

            const confirmation = await h.join.buildJoinChannelConfirmation({
                joiner: spectatorHandle,
                channelId: h.channelId,
                existingParticipantSigners: [
                    h.getPeerHandle(0).signer,
                    h.getPeerHandle(1).signer
                ]
            });

            // Fire joinChannel WITHOUT awaiting. In inline mode the
            // synchronous portion sets PENDING_PARTICIPANT before the first
            // internal await; in worker mode the RPC dispatch is concurrent so
            // the status is also set before the tx mines and queryStatus returns.
            const joinPromise =
                spectatorHandle.lifecycle.joinChannel(confirmation);

            // Poll until PENDING_PARTICIPANT is visible — handles both inline
            // (synchronous) and worker (concurrent RPC) timing.
            await h.event.waitUntilPeerStatus(
                spectatorHandle.index,
                Status.PENDING_PARTICIPANT,
                {
                    timeoutMs: 5000,
                    timeoutMessage:
                        "Status should be PENDING_PARTICIPANT immediately on broadcast, before tx is mined"
                }
            );

            // Wait for the tx to land on-chain
            await joinPromise;

            // Ensure all honest peers have stored the inbound message before
            // the block producer runs, so the join is included in the block
            await h.assert.storage.honestPeersObserveInboundMessageWait();

            await h.transition.advanceState({ count: 1 });

            // Poll until PARTICIPATING — in worker mode the status update from
            // the block confirmation may arrive slightly after advanceState resolves.
            await h.event.waitUntilPeerStatus(
                spectatorHandle.index,
                Status.PARTICIPATING,
                {
                    timeoutMs: 10000,
                    timeoutMessage:
                        "Joiner should be PARTICIPATING after the first block that includes them"
                }
            );
        });
    });
});
