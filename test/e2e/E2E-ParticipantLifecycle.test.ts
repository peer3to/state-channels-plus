import { TestSession, PeerTestHarness } from "@test/harness";
import { expect } from "chai";
import { Status } from "@/types";
import { SignatureUtils } from "@/utils";
import Clock from "@/Clock";
import type {
    JoinChannelConfirmationStruct,
    JoinChannelStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import type { BytesLike } from "ethers";

PeerTestHarness.setDefaultLogLevel("error");

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

            const leaverIndex = await h.transition.participantLeave();
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

            // Add spectator — `addPeer` connects and waits for SYNCED
            const spectator = await h.addPeer(undefined, {
                statusTimeoutMs: 5000,
                statusTimeoutMessage: "Spectator did not reach SYNCED status"
            });
            await h.assert.sync.peersInSyncWait({ peerIndices: [0, 1, 2] });

            // Build JoinChannelConfirmationStruct --------------------------
            const jc: JoinChannelStruct = {
                participant: spectator.address,
                channelId: h.channelId,
                balance: { amount: 500n, data: "0x00" },
                deadlineTimestamp: BigInt(Clock.getTimeInSeconds() + 120)
            };

            // Joiner self-attestation
            const joinerSigned = await SignatureUtils.signJoinChannel(
                jc,
                spectator.signer
            );

            // Participant approvals
            const [sig0, sig1] = await Promise.all([
                SignatureUtils.signJoinChannel(jc, h.peers[0].signer),
                SignatureUtils.signJoinChannel(jc, h.peers[1].signer)
            ]);

            const confirmation: JoinChannelConfirmationStruct = {
                signedJoinChannel: {
                    encodedJoinChannel: joinerSigned.encoded as BytesLike,
                    signature: joinerSigned.signature as BytesLike
                },
                signatures: [
                    sig0.signature as BytesLike,
                    sig1.signature as BytesLike
                ]
            };
            // --------------------------------------------------------------

            // Fire joinChannel WITHOUT awaiting — the synchronous portion of
            // StateManager.joinChannel() calls setStatus(PENDING_PARTICIPANT)
            // before the first `await`, so the promotion is observable
            // immediately after the call starts.
            const joinPromise =
                spectator.p2pInstance.p2pSigner.joinChannel(confirmation);

            // Status must already be PENDING_PARTICIPANT — no await needed
            expect(spectator.stateManager.getStatus()).to.equal(
                Status.PENDING_PARTICIPANT,
                "Status should be PENDING_PARTICIPANT immediately on broadcast, before tx is mined"
            );

            // Wait for the tx to land on-chain
            await joinPromise;

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
