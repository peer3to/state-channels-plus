import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";

describe("E2E: resume from background", function () {
    it("resumes through its only peer when a reactive sync is already in flight", async function () {
        const h = TestSession.getHarness();
        // resume budget = 50% of (p2p + agreement + chainFallback) = 6s.
        // control port timeout (agreementTime) = 10s, so the port outlives the
        // budget - a regression here fails the assertion below, not the harness.
        await h.lifecycle.start(2, 0, {
            timeConfig: {
                p2pTime: 1,
                agreementTime: 10,
                chainFallbackTime: 1,
                evidenceTime: 4
            }
        });

        const resuming = h.getPeer(0);
        const onlyPeer = h.getPeer(1);

        // Same call the reactive validation pipeline makes - holds the
        // in-flight guard for this peer. `sync()` adds to
        // `inFlightByPeerAddress` synchronously (before its first await), so
        // by the time this request resolves the guard is already set.
        await h
            .control(resuming)
            .spectate.triggerSync(onlyPeer.address, h.channelId)
            .sendOne();

        const guardHeldAtStart = await h
            .control(resuming)
            .spectate.isSyncInFlight(onlyPeer.address)
            .request();
        expect(
            guardHeldAtStart,
            "precondition: the reactive sync must still hold the in-flight guard when resume starts"
        ).to.equal(true);

        // Drive resume through the real consumer-facing surface (P2pInstance),
        // not a host-side escape hatch - this is the path be-02 actually ships.
        const result = await resuming.p2pInstance.resumeFromBackground();

        expect(
            result.status,
            `resume against a healthy, in-sync peer must not report failure ` +
                `(got ${JSON.stringify(result)})`
        ).to.equal("restored");
    });

    it("blacklists a peer that serves an undecodable payload - on both the sync and resume paths", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0, {
            timeConfig: {
                p2pTime: 1,
                agreementTime: 10,
                chainFallbackTime: 1,
                evidenceTime: 4
            }
        });

        const victim = h.getPeer(0);
        const fraudster = h.getPeer(1);

        // Fraudster answers spectate requests with bytes that aren't a valid
        // SyncPayload. That's unambiguously its fault - our own state can't
        // make it send undecodable bytes - so it must be punished the same way
        // a resume punishes it as the plain reactive sync path does.
        await h.rpcStub.stubSpectateJunkPayload([1]);

        const result = await victim.p2pInstance.resumeFromBackground();

        const blacklistedAfterResume = await h
            .control(victim)
            .query.isBlacklisted(fraudster.address)
            .request();

        expect(
            blacklistedAfterResume,
            `resume must punish the same fraud the plain sync path punishes ` +
                `(resume returned ${JSON.stringify(result)})`
        ).to.equal(true);
    });
});
