import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";

describe("E2E: Spectate stale-proof guard", function () {
    it("aborts sync when on-chain snapshot is more advanced than what participant proved", async function () {
        const h = TestSession.getHarness();

        await h.lifecycle.start(2, 0, {
            timeConfig: {
                p2pTime: 5,
                agreementTime: 2,
                chainFallbackTime: 2,
                evidenceTime: 10
            }
        });

        await h.transition.advanceState({
            count: 4,
            waitForFinalization: true
        });
        await h.transition.postSnapshotWait();

        const staleBlockHeight = 1;

        // Stub both participants to respond with a stale proof regardless of what
        // was actually requested by the spectator.
        await h.rpcStub.stubSpectateStaleProof([0, 1], staleBlockHeight);

        // addPeerWait throws if the spectator doesn't reach SYNCED within the timeout.
        // With stale proofs, the guard aborts every sync attempt, so SYNCED is never reached.
        let threwTimeout = false;
        try {
            await h.join.addSpectatorWait({ statusTimeoutMs: 5000 });
        } catch (e: any) {
            threwTimeout = true;
        }

        expect(threwTimeout).to.equal(
            true,
            "Spectator should not have reached SYNCED with stale proofs"
        );

        const spectator = h.getPeer(2);
        expect(
            await h.control(spectator).query.getOpenConnectionCount().request()
        ).to.equal(0, "Spectator should have 0 open connections after abort");
    });

    it("aborts sync when a peer answers with undecodable junk bytes", async function () {
        const h = TestSession.getHarness();

        await h.lifecycle.start(2, 2, {
            timeConfig: {
                p2pTime: 5,
                agreementTime: 2,
                chainFallbackTime: 2,
                evidenceTime: 10
            }
        });

        // Both participants reply to spectate requests with bytes that are NOT a
        // valid encoded SyncPayload, so the spectator's Codec.decode throws and
        // it must abort every sync attempt instead of crashing/hanging.
        await h.rpcStub.stubSpectateJunkPayload([0, 1]);

        let threwTimeout = false;
        try {
            await h.join.addSpectatorWait({ statusTimeoutMs: 5000 });
        } catch {
            threwTimeout = true;
        }

        expect(threwTimeout).to.equal(
            true,
            "Spectator should not have reached SYNCED with junk payloads"
        );

        const spectator = h.getPeer(2);
        expect(
            await h.control(spectator).query.getOpenConnectionCount().request()
        ).to.equal(
            0,
            "Spectator should have 0 open connections after aborting on junk"
        );
    });
});
