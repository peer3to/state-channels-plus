import { expect } from "chai";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { Status } from "@/types";

/**
 * End-to-end proof of the ambiguous (chain-view-dependent, unpunished) side
 * of the resume-path fraud-punishment taxonomy: a stale proof must fail
 * resume with "chain-view-mismatch" and must NOT blacklist/disconnect the
 * peer or touch the state manager.
 *
 * This is the resume-path equivalent of
 * test/e2e/E2E-SpectateStaleProofGuard.test.ts's reactive/spectator-join
 * proof of the same underlying mechanism, and deliberately mirrors that
 * file's simple, isolated 2-peer setup rather than being folded into
 * test/e2e/E2E-ResumeInvalidPayloadPolicy.test.ts's shared 6-peer session.
 *
 * It used to live as a 4th sequential sub-scenario in that shared session,
 * after 3 prior fault-injection scenarios' worth of blacklisting/state
 * activity. Under this sandbox's CPU contention, that much prior activity
 * occasionally tripped a real, incidental on-chain dispute during setup or
 * mid-test, which legitimately (and correctly, per the taxonomy) made some
 * peer's local fork-tracking diverge or lag - exactly the class of ambiguous
 * condition this proof is designed to tolerate without punishment, but it
 * made THIS SPECIFIC scenario's assertion (which expects
 * "chain-view-mismatch" specifically from the stale-proof stub) flaky: it
 * would sometimes observe "request-failed" or a genuine but different
 * ambiguous reason instead, or - in the worst case - a peer's own forkId
 * cache never re-converged within the test's timeout, since nothing in the
 * shared session gave it a fresh trigger to recheck. A clean 2-peer session
 * with no prior scenario complexity removes that source of incidental
 * disputes entirely, matching E2E-SpectateStaleProofGuard.test.ts's proven
 * reliability.
 */
describe("E2E: resume ambiguous-failure policy", function () {
    it("fails resume with chain-view-mismatch on a stale proof, without blacklisting/disconnecting the peer or touching the state manager", async function () {
        this.timeout(60000);

        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0, {
            timeConfig: {
                p2pTime: 5,
                agreementTime: 2,
                chainFallbackTime: 2,
                evidenceTime: 10
            }
        });

        const victim = h.getPeer(0);
        const stalePeer = h.getPeer(1);

        await h.transition.advanceState({
            count: 4,
            waitForFinalization: true
        });
        await h.transition.postSnapshotWait();

        // Install the abort recorder before disconnecting/resuming so any
        // stray call to stateManager.abort() during the resume attempt below
        // is caught.
        await h.control(victim).stub.stubRecordSpectateAbort().request();

        // Disconnect the victim from its only peer so resumeFromBackground
        // has exactly one candidate to reconnect to and sync against: the
        // stale-proof stub installed below.
        await h
            .control(victim)
            .network.disconnectPeerByAddress(stalePeer.address)
            .request();
        await waitFor(
            async () =>
                !(await h
                    .control(victim)
                    .query.isConnectedTo(stalePeer.address)
                    .request()),
            10000
        );

        const staleBlockHeight = 1;
        const teardownStaleProof = await h.rpcStub.stubSpectateStaleProof(
            [1],
            staleBlockHeight
        );

        // Reconnect via the harness's real connect path so resumeFromBackground
        // has a candidate to sync against.
        await h.network.connectPeers([0, 1]);
        await h.network.waitForP2PConnections();

        const result = await victim.p2pInstance.resumeFromBackground();

        expect(
            result,
            `resume against a peer serving a proof stale relative to the on-chain snapshot must fail with the ambiguous, chain-view-dependent reason "chain-view-mismatch" (got ${JSON.stringify(result)})`
        ).to.deep.equal({
            status: "failed",
            reason: "chain-view-mismatch",
            retryable: true
        });

        expect(
            await h
                .control(victim)
                .query.isBlacklisted(stalePeer.address)
                .request(),
            "an ambiguous, chain-view-dependent failure must NOT blacklist the peer on resume"
        ).to.equal(false);
        expect(
            await h
                .control(victim)
                .query.isConnectedTo(stalePeer.address)
                .request(),
            "an ambiguous failure must NOT disconnect the peer on resume"
        ).to.equal(true);

        expect(
            await h.control(victim).query.getStatus().request(),
            "victim must still be a normal participant after a resume-path failure"
        ).to.equal(Status.PARTICIPATING);

        expect(
            await h.control(victim).stub.wasSpectateAbortCalled().request(),
            "stateManager.abort() must never be reachable from the resume path, ambiguous or not"
        ).to.equal(false);

        await teardownStaleProof();
    });
});
