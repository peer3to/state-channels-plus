import { Status } from "@/types";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
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
            count: 2,
            waitForFinalization: true
        });
        const staleBlockHeight = 1;

        // Stub both participants to respond with a stale proof regardless of what
        // was actually requested by the spectator.
        await h.rpcStub.stubSpectateStaleProof([0, 1], staleBlockHeight);
        await h.transition.advanceState({
            count: 2,
            waitForFinalization: true
        });
        await h.transition.postSnapshotWait();

        // addPeerWait throws if the spectator doesn't reach SYNCED within the timeout.
        // With stale proofs, the guard aborts every sync attempt, so SYNCED is never reached.
        let threwTimeout = false;
        try {
            // Spawn-only, classified (plan 30 item 5): the sync is meant to fail and no
            // transition is scheduled while it runs, so the idle fork is by design.
            await h.join.addSpectatorWait({ statusTimeoutMs: 5000 });
        } catch (e: any) {
            threwTimeout = true;
        }

        expect(threwTimeout).to.equal(
            true,
            "Spectator should not have reached SYNCED with stale proofs"
        );
        await TestSession.settleDetached({
            expectedErrorIncludes: "connectToChannel failed"
        });

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
            // Spawn-only, classified (plan 30 item 5): the sync is meant to fail and no
            // transition is scheduled while it runs, so the idle fork is by design.
            await h.join.addSpectatorWait({ statusTimeoutMs: 5000 });
        } catch {
            threwTimeout = true;
        }

        expect(threwTimeout).to.equal(
            true,
            "Spectator should not have reached SYNCED with junk payloads"
        );
        await TestSession.settleDetached({
            expectedErrorIncludes: "connectToChannel failed"
        });

        const spectator = h.getPeer(2);
        expect(
            await h.control(spectator).query.getOpenConnectionCount().request()
        ).to.equal(
            0,
            "Spectator should have 0 open connections after aborting on junk"
        );
    });

    // A participant must blacklist a responder that supplies a real but stale proof.
    it("blacklists the responder when a participant receives a proof behind the on-chain snapshot", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0, {
            timeConfig: {
                p2pTime: 5,
                agreementTime: 3,
                chainFallbackTime: 2,
                evidenceTime: 10
            }
        });

        await h.transition.advanceState({
            count: 2,
            waitForFinalization: true
        });
        const requester = h.getPeer(1);
        const responder = h.getPeer(0);
        const forkId = h.activeForkId!;
        const staleHeight = 1;
        await h.rpcStub.stubSpectateStaleProof([responder.index], staleHeight);
        await h.transition.advanceState({
            count: 2,
            waitForFinalization: true
        });
        await h.transition.postSnapshotWait();

        // The requester is an active participant, so a verification abort
        // blacklists the responder (rather than aborting the node).
        expect(await h.control(requester).query.getStatus().request()).to.equal(
            Status.PARTICIPATING
        );

        await h
            .control(requester)
            .spectate.startSync(responder.address, forkId, staleHeight)
            .request();

        // The stale-proof bound aborts the sync and the participant blacklists
        // the responder.
        await waitFor(
            async () =>
                await h
                    .control(requester)
                    .query.isBlacklisted(responder.address)
                    .request(),
            h.event.protocolEventTimeoutMs()
        );
        expect(
            await h
                .control(requester)
                .query.isBlacklisted(responder.address)
                .request()
        ).to.equal(true, "participant should blacklist the responder");
    });
});
