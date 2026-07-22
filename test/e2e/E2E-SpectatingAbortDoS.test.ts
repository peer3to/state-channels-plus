import { expect } from "chai";

import { Status } from "@/types";
import { MathTestSession as TestSession } from "@test/harness";

// A non-participant that sends a spectator a block it must reject should be
// dropped + blacklisted, never able to take the spectator offline. Covers both
// rejection paths: unauthenticated junk (rejected synchronously in ingest) and
// an authenticated outsider-authored block (queued, then rejected when
// executeQueuedEntry runs onBlockConfirmation).
describe("E2E: spectating strategy junk-block handling", function () {
    it("cuts the sender of an unauthenticated junk block and keeps a SYNCED spectator running", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 1);
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
                timeoutMs: h.event.protocolEventTimeoutMs(1),
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
            target: attacker
        });
    });

    it("cuts the sender of an unauthenticated junk block and keeps a PENDING_PARTICIPANT running", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 1);
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
                timeoutMs: h.event.protocolEventTimeoutMs(1),
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
            target: attacker
        });
    });

    it("cuts the sender of an authenticated outsider-authored block over the live queue and keeps a SYNCED spectator running", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 1);
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
                timeoutMs: h.event.protocolEventTimeoutMs(1),
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
            target: attacker
        });
    });
});
