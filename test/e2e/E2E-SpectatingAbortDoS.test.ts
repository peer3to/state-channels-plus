import { expect } from "chai";

import { Status } from "@/types";
import { MathTestSession as TestSession } from "@test/harness";

describe("E2E: spectating strategy junk-block handling", function () {
    it("blacklists the sender but keeps a SYNCED spectator running on a junk block from a non-participant", async function () {
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
        expect(
            await h.control(victim).query.getStatus().request()
        ).to.equal(Status.SYNCED);

        const { encodedBlockConfirmation } =
            await h.byzantine.craftJunkBlockConfirmation(0, forkId);
        await h
            .control(attacker)
            .byzantine.sendBlockConfirmation(
                encodedBlockConfirmation,
                victim.address
            )
            .request();

        await h.disconnectionBarrier.waitFor(
            async () =>
                await h
                    .control(victim)
                    .query.isBlacklisted(attacker.address)
                    .request(),
            {
                timeoutMs: h.event.protocolEventTimeoutMs(1),
                timeoutMessage: "victim never blacklisted attacker"
            }
        );
        expect(
            await h.control(victim).query.getStatus().request()
        ).to.equal(Status.SYNCED);
    });

    it("keeps a PENDING_PARTICIPANT running on a junk block from a non-participant", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 1);
        const forkId = h.activeForkId!;

        const victim = await h.join.addSpectatorWait();
        await h.join.joinChannelWait({ joiner: victim });
        expect(
            await h.control(victim).query.getStatus().request()
        ).to.equal(Status.PENDING_PARTICIPANT);

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

        await h.disconnectionBarrier.waitFor(
            async () =>
                await h
                    .control(victim)
                    .query.isBlacklisted(attacker.address)
                    .request(),
            {
                timeoutMs: h.event.protocolEventTimeoutMs(1),
                timeoutMessage: "victim never blacklisted attacker"
            }
        );
        expect(
            await h.control(victim).query.getStatus().request()
        ).to.equal(Status.PENDING_PARTICIPANT);
    });

    it("does not abort a SYNCED spectator validating an authenticated block from a non-participant author", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 1);
        const forkId = h.activeForkId!;

        const victim = await h.join.addSpectatorWait();
        expect(
            await h.control(victim).query.getStatus().request()
        ).to.equal(Status.SYNCED);

        const { encodedBlockConfirmation } =
            await h.byzantine.craftOutsiderAuthoredBlockConfirmation(0, forkId);
        const { aborted, result } = await h
            .control(victim)
            .stub.probeSpectateBlockNoAbort(encodedBlockConfirmation)
            .request();

        expect(result).to.equal("DISCONNECT");
        expect(aborted).to.equal(false);
        expect(
            await h.control(victim).query.getStatus().request()
        ).to.equal(Status.SYNCED);
    });
});
