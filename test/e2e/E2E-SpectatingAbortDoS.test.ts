import { expect } from "chai";

import { Status } from "@/types";
import {
    MathTestSession as TestSession,
    MIN_TEST_TIME_CONFIG
} from "@test/harness";

// A non-participant that sends a spectator a block it must reject should be
// dropped + blacklisted, never able to take the spectator offline. Covers both
// rejection paths: unauthenticated junk (rejected synchronously in ingest) and
// an authenticated outsider-authored block (queued, then rejected when
// executeQueuedEntry runs onBlockConfirmation).

const LIVE_FORK_TIME = {
    ...MIN_TEST_TIME_CONFIG,
    chainFallbackTime: 12
};

describe("E2E: spectating strategy junk-block handling", function () {
    it("cuts the sender of an unauthenticated junk block and keeps a SYNCED spectator running", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 1, { timeConfig: LIVE_FORK_TIME });
        const forkId = h.activeForkId!;

        const victim = await h.join.addSpectatorWait();
        const attacker = await h.join.addSpectator();
        await h.connectionBarrier.waitFor(
            async () =>
                await h
                    .control(attacker)
                    .query.isConnectedTo(victim.address)
                    .request(),
            {
                timeoutMs: h.event.protocolEventTimeoutMs(),
                timeoutMessage: "attacker never connected to victim"
            }
        );

        const { encodedBlockConfirmation } =
            await h.byzantine.craftJunkBlockConfirmation(0, forkId);
        await h
            .control(attacker)
            .byzantine.sendBlockConfirmation(
                encodedBlockConfirmation,
                victim.address
            )
            .request();

        await h.assert.rpc.peerBlacklistedAndDisconnected({
            observer: victim,
            target: attacker,
            expectedStatus: Status.SYNCED
        });
    });

    it("cuts the sender of an unauthenticated junk block and keeps a PENDING_PARTICIPANT running", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 1, { timeConfig: LIVE_FORK_TIME });
        const forkId = h.activeForkId!;

        const victim = await h.join.addSpectatorWait();
        await h.join.joinChannelWait({ joiner: victim });
        expect(await h.control(victim).query.getStatus().request()).to.equal(
            Status.PENDING_PARTICIPANT
        );

        const attacker = await h.join.addSpectator();
        await h.connectionBarrier.waitFor(
            async () =>
                await h
                    .control(attacker)
                    .query.isConnectedTo(victim.address)
                    .request(),
            {
                timeoutMs: h.event.protocolEventTimeoutMs(),
                timeoutMessage: "attacker never connected to victim"
            }
        );

        const { encodedBlockConfirmation } =
            await h.byzantine.craftJunkBlockConfirmation(0, forkId);
        await h
            .control(attacker)
            .byzantine.sendBlockConfirmation(
                encodedBlockConfirmation,
                victim.address
            )
            .request();

        await h.assert.rpc.peerBlacklistedAndDisconnected({
            observer: victim,
            target: attacker,
            expectedStatus: Status.PENDING_PARTICIPANT
        });
    });

    it("cuts the sender of an authenticated outsider-authored block over the live queue and keeps a SYNCED spectator running", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 1, { timeConfig: LIVE_FORK_TIME });
        const forkId = h.activeForkId!;

        const victim = await h.join.addSpectatorWait();
        const attacker = await h.join.addSpectator();
        await h.connectionBarrier.waitFor(
            async () =>
                await h
                    .control(attacker)
                    .query.isConnectedTo(victim.address)
                    .request(),
            {
                timeoutMs: h.event.protocolEventTimeoutMs(),
                timeoutMessage: "attacker never connected to victim"
            }
        );

        // the attacker is connected to the channel's p2p network but is not a
        // channel participant. it authors + signs a well-formed next block with
        // its own key: authentication passes, so it is queued and validated fresh
        // -> reaches blockAuthorIsNotParticipant on the live queue, not the inline
        // authenticate-failed path the junk cases hit. this is the vector that
        // used to abort the spectator.
        const { encodedBlockConfirmation } =
            await h.byzantine.craftOutsiderAuthoredBlockConfirmation(
                0,
                forkId,
                attacker.signer
            );
        await h
            .control(attacker)
            .byzantine.sendBlockConfirmation(
                encodedBlockConfirmation,
                victim.address
            )
            .request();

        await h.assert.rpc.peerBlacklistedAndDisconnected({
            observer: victim,
            target: attacker,
            expectedStatus: Status.SYNCED
        });
    });

    // supplier != author. every other case here has the attacker author the
    // block it sends, so they cannot tell "cut the supplier" from "cut the
    // author" - this one separates them and asserts that both are cut.
    it("cuts both the relayer and the author when an outsider-authored block arrives via a different peer", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 1, { timeConfig: LIVE_FORK_TIME });
        const forkId = h.activeForkId!;

        const victim = await h.join.addSpectatorWait();
        // two distinct non-participants: one signs the block, the other hands it
        // to the victim. neither is in the channel.
        const author = await h.join.addSpectator();
        const relayer = await h.join.addSpectator();
        await h.connectionBarrier.waitFor(
            async () =>
                (await h
                    .control(relayer)
                    .query.isConnectedTo(victim.address)
                    .request()) &&
                (await h
                    .control(author)
                    .query.isConnectedTo(victim.address)
                    .request()),
            {
                timeoutMs: h.event.protocolEventTimeoutMs(),
                timeoutMessage: "relayer/author never both connected to victim"
            }
        );

        const { encodedBlockConfirmation } =
            await h.byzantine.craftOutsiderAuthoredBlockConfirmation(
                0,
                forkId,
                author.signer
            );
        // the relayer never authored anything - it only supplied the transport
        await h
            .control(relayer)
            .byzantine.sendBlockConfirmation(
                encodedBlockConfirmation,
                victim.address
            )
            .request();

        await h.assert.rpc.peerBlacklistedAndDisconnected({
            observer: victim,
            target: relayer,
            expectedStatus: Status.SYNCED
        });
        await h.assert.rpc.peerBlacklistedAndDisconnected({
            observer: victim,
            target: author,
            expectedStatus: Status.SYNCED
        });
    });

    // A participant that has LEFT is still connected. Snapshots are keyed by hash
    // and never pruned, so the ex-member authors a block naming a snapshot from
    // while it was still a member; without the coordinate binding the author gate
    // unions that stale snapshot and re-admits it, the block reaches the leader
    // check, and the spectator aborts as if a participant misbehaved. An ex-member
    // is a non-participant: drop it, never abort.
    it("cuts an ex-member that authors a linked block naming a stale membership snapshot, keeping the spectator SYNCED", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(4, 0, { timeConfig: LIVE_FORK_TIME });
        const forkId = h.activeForkId!;

        // victim spectates and stores the pre-leave snapshots (still listing the
        // leaver as a participant)
        const victim = await h.join.addSpectatorWait();
        await h.transition.advanceState({ count: 2 });

        const staleHeight = await h
            .control(h.getPeer(0))
            .query.getLatestBlockHeight(forkId)
            .request();

        const leaverIndex = await h.transition.participantLeaveWait();
        const leaver = h.getPeer(leaverIndex);

        // move past the leave so the current previous snapshot excludes them
        await h.transition.advanceState({ count: 2 });

        const participants = await h
            .control(h.getPeer(0))
            .query.getParticipants()
            .request();
        expect(
            participants.map((p) => p.toLowerCase()),
            "leaver should be out of the current participant set"
        ).to.not.include(leaver.address.toLowerCase());

        const { encodedBlockConfirmation } =
            await h.byzantine.craftStaleMembershipBlockConfirmation(
                0,
                forkId,
                leaver.signer,
                staleHeight!
            );
        await h
            .control(leaver)
            .byzantine.sendBlockConfirmation(
                encodedBlockConfirmation,
                victim.address
            )
            .request();

        await h.assert.rpc.peerBlacklistedAndDisconnected({
            observer: victim,
            target: leaver,
            expectedStatus: Status.SYNCED
        });
    });
});

describe("E2E: active-participant stale-membership handling", function () {
    it("cuts an ex-member's stale-membership block, stays PARTICIPATING, starts no dispute", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(4, 0, { timeConfig: LIVE_FORK_TIME });
        const forkId = h.activeForkId!;

        // build the pre-leave snapshot the ex-member will name
        await h.transition.advanceState({ count: 2 });
        const staleHeight = await h
            .control(h.getPeer(0))
            .query.getLatestBlockHeight(forkId)
            .request();

        // a participant leaves; move past the leave so the current previous
        // snapshot excludes them
        const leaverIndex = await h.transition.participantLeaveWait();
        const leaver = h.getPeer(leaverIndex);
        await h.transition.advanceState({ count: 2 });

        // victim = an active participant that is not the leaver; read the craft
        // source from it too so the crafted block links to the live head (the
        // departed leaver may no longer track it)
        const victim = h
            .getActiveHonestPeers()
            .find((p) => p.index !== leaverIndex)!;
        expect(
            await h.control(victim).query.getStatus().request(),
            "victim is an active participant"
        ).to.equal(Status.PARTICIPATING);

        const participants = await h
            .control(victim)
            .query.getParticipants()
            .request();
        expect(
            participants.map((p) => p.toLowerCase()),
            "leaver should be out of the current participant set"
        ).to.not.include(leaver.address.toLowerCase());

        // clean dispute-event baseline before the attack
        h.event.resetEventSpies();

        const { encodedBlockConfirmation } =
            await h.byzantine.craftStaleMembershipBlockConfirmation(
                victim.index,
                forkId,
                leaver.signer,
                staleHeight!
            );
        await h
            .control(leaver)
            .byzantine.sendBlockConfirmation(
                encodedBlockConfirmation,
                victim.address
            )
            .request();

        // leaver (author == sender) is cut, victim keeps participating
        await h.assert.rpc.peerBlacklistedAndDisconnected({
            observer: victim,
            target: leaver,
            expectedStatus: Status.PARTICIPATING
        });
        // no false dispute against the honest fork, everyone still in sync
        h.assert.dispute.noDisputes();
        await h.assert.sync.onlyHonestPeersInSync();
    });
});
