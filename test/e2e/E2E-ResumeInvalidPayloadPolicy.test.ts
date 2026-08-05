import { expect } from "chai";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { Status } from "@/types";

/**
 * End-to-end proof of the fraud-punishment taxonomy (be-02's headline
 * security fix): resume must blacklist a peer on PEER_PROVABLE_REASONS
 * (malformed-payload, invalid-proof) exactly the way the reactive/non-resume
 * path always has, and never hard-aborts the local state manager mid-resume.
 *
 * Before this fix, only undecodable bytes ("malformed-payload") were
 * punished on resume; a well-formed-but-provably-invalid payload
 * ("invalid-proof" - e.g. a corrupted state hash) passed through resume with
 * ZERO punishment. The "well-formed-but-provably-invalid" scenarios below are
 * the headline proof that this is now fixed.
 *
 * The ambiguous (chain-view-dependent, unpunished) side of the taxonomy is
 * proved separately in test/e2e/E2E-ResumeAmbiguousFailurePolicy.test.ts, in
 * its own isolated 2-peer session - see that file's doc comment for why it
 * was split out of this one.
 *
 * The reactive (non-resume, fire-and-forget) path and the resume path are
 * deliberately split into distinct, separately-asserted scenarios - the
 * predecessor of this file (test/e2e/E2E-ResumeFromBackground.test.ts's
 * "blacklists a peer that serves an undecodable payload - on both the sync
 * and resume paths" case) claimed to cover both paths in one assertion while
 * only actually exercising resume. That mistake is not repeated here.
 *
 * All scenarios run inside ONE harness session/`it` (this repo's harness
 * cannot stand up a second full peer session in the same process - see
 * test/e2e/E2E-ResumePeerRotation.test.ts for the same constraint), staged
 * sequentially with peers connected only when the scenario under test needs
 * them - a leftover healthy connection from an earlier scenario would let
 * `resumeFromBackground()` succeed via the wrong candidate and silently
 * short-circuit the proof.
 */
describe("E2E: resume invalid-payload punishment policy", function () {
    it("blacklists peer-provable fraud on resume and never hard-aborts the state manager", async function () {
        this.timeout(120000);

        const h = TestSession.getHarness();
        // resume budget = 50% of (p2pTime + agreementTime + chainFallbackTime)
        // = 8s. Reverted to the tighter, faster tuning that reliably passed
        // the 3 fault-injection scenarios below before the (now-removed)
        // ambiguous/stale-proof scenario's extra shared-session complexity
        // started tripping incidental on-chain disputes under sandbox CPU
        // contention - see E2E-ResumeAmbiguousFailurePolicy.test.ts's doc
        // comment for the full investigation.
        await h.lifecycle.start(5, 0, {
            autoConnect: false,
            timeConfig: {
                p2pTime: 3,
                agreementTime: 10,
                chainFallbackTime: 3,
                evidenceTime: 4
            }
        });

        const victim = h.getPeer(0);
        const reactiveFraudster = h.getPeer(1);
        const resumeMalformedPeer = h.getPeer(2);
        const resumeCorruptFinalizedPeer = h.getPeer(3);
        const resumeCorruptGenesisPeer = h.getPeer(4);

        /** Connects the given peer indices to the mesh and waits until the
         * victim sees each non-zero index as connected. */
        async function connectAndWait(indices: number[]): Promise<void> {
            await h.network.connectPeers(indices);
            const toCheck = indices.filter((i) => i !== 0);
            await Promise.all(
                toCheck.map((i) =>
                    waitFor(
                        () =>
                            h
                                .control(victim)
                                .query.isConnectedTo(h.getPeer(i).address)
                                .request(),
                        10000
                    )
                )
            );
        }

        /** Disconnects the victim's connection toward `address` and confirms
         * it's gone from its candidate set. */
        async function disconnectFromVictim(address: string): Promise<void> {
            await h
                .control(victim)
                .network.disconnectPeerByAddress(address)
                .request();
            const stillConnected = await h
                .control(victim)
                .query.isConnectedTo(address)
                .request();
            expect(
                stillConnected,
                `expected ${address} to be disconnected from the victim`
            ).to.equal(false);
        }

        /**
         * Resume, retrying only on "request-failed" - the RPC-layer/transient
         * reason, not a classification outcome. The single candidate peer in
         * each corrupted-payload scenario below can occasionally answer with a
         * transport-level failure of its own (its local event/dispute
         * processing catching up) rather than the classification-relevant
         * response we're testing for; since resumeFromBackground has exactly
         * one candidate in these isolated scenarios (by design - see the file
         * comment above), it has no other peer to fall back to and reports
         * that single transient failure as final. Retrying the resume call
         * itself (not weakening the assertion on its result) gives the
         * responder another chance to actually answer before we lock in the
         * classification we're proving.
         */
        async function resumeRetryingTransientFailure(): Promise<
            Awaited<ReturnType<typeof victim.p2pInstance.resumeFromBackground>>
        > {
            const maxAttempts = 6;
            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                const result = await victim.p2pInstance.resumeFromBackground();
                if (
                    !(
                        result.status === "failed" &&
                        result.reason === "request-failed"
                    ) ||
                    attempt === maxAttempts
                ) {
                    return result;
                }
                await new Promise((resolve) => setTimeout(resolve, 1500));
            }
            throw new Error("unreachable");
        }

        async function expectStillParticipating(): Promise<void> {
            const status = await h.control(victim).query.getStatus().request();
            expect(
                status,
                "victim must still be a normal participant after a resume-path failure"
            ).to.equal(Status.PARTICIPATING);
        }

        // Establish full connectivity so a real on-chain snapshot can be
        // advanced and finalized (finalization needs every participant's
        // signature) before any per-scenario isolation.
        await connectAndWait([0, 1, 2, 3, 4]);
        await h.transition.advanceState({
            count: 4,
            waitForFinalization: true
        });
        await h.transition.postSnapshotWait();

        // ==================================================================
        // REACTIVE PATH (regression guard, NOT resume): a peer serving
        // undecodable junk bytes to a fire-and-forget, non-resume sync gets
        // blacklisted - confirms this pre-existing punishment is unchanged by
        // the resume-path taxonomy work.
        // ==================================================================
        const teardownReactiveJunk = await h.rpcStub.stubSpectateJunkPayload([
            1
        ]);

        await h
            .control(victim)
            .spectate.startSync(reactiveFraudster.address)
            .request();

        await waitFor(
            () =>
                h
                    .control(victim)
                    .query.isBlacklisted(reactiveFraudster.address)
                    .request(),
            10000
        );
        expect(
            await h
                .control(victim)
                .query.isBlacklisted(reactiveFraudster.address)
                .request(),
            "reactive (non-resume) sync must still blacklist a peer serving undecodable bytes"
        ).to.equal(true);

        await teardownReactiveJunk();

        // Install the abort recorder only AFTER the reactive scenario above -
        // that scenario legitimately routes through spectateService.abort()
        // (the non-resume/window-closed destructive path), so recording from
        // here on isolates the resume-path assertions below from that
        // expected, unrelated call.
        await h.control(victim).stub.stubRecordSpectateAbort().request();

        // ==================================================================
        // RESUME PATH, malformed bytes: peer-provable ("malformed-payload"),
        // must blacklist+disconnect and must not touch the state manager.
        // ==================================================================
        await disconnectFromVictim(resumeCorruptFinalizedPeer.address);
        await disconnectFromVictim(resumeCorruptGenesisPeer.address);

        const teardownResumeMalformed = await h.rpcStub.stubSpectateJunkPayload(
            [2]
        );

        const malformedResult = await victim.p2pInstance.resumeFromBackground();

        expect(
            malformedResult,
            `resume against a peer serving undecodable bytes must fail with reason "malformed-payload" (got ${JSON.stringify(malformedResult)})`
        ).to.deep.equal({
            status: "failed",
            reason: "malformed-payload",
            retryable: true
        });

        expect(
            await h
                .control(victim)
                .query.isBlacklisted(resumeMalformedPeer.address)
                .request(),
            "resume must blacklist a peer that served undecodable bytes - this is peer-provable fraud"
        ).to.equal(true);

        await expectStillParticipating();
        expect(
            await h.control(victim).stub.wasSpectateAbortCalled().request(),
            "stateManager.abort() must never be reachable from the resume path"
        ).to.equal(false);

        await teardownResumeMalformed();

        // ==================================================================
        // RESUME PATH, well-formed-but-provably-invalid payload (finalized
        // state hash corrupted): peer-provable ("invalid-proof"). THIS IS THE
        // HEADLINE CASE - before this fix, this exact scenario passed with
        // ZERO punishment on resume.
        // ==================================================================
        await connectAndWait([3]);

        const teardownCorruptFinalized =
            await h.rpcStub.stubSpectateCorruptPayload(
                [3],
                "finalized-state-hash"
            );

        const corruptFinalizedResult = await resumeRetryingTransientFailure();

        expect(
            corruptFinalizedResult,
            `resume against a peer serving a payload with a corrupted finalized-state hash must fail with reason "invalid-proof" (got ${JSON.stringify(corruptFinalizedResult)})`
        ).to.deep.equal({
            status: "failed",
            reason: "invalid-proof",
            retryable: true
        });

        expect(
            await h
                .control(victim)
                .query.isBlacklisted(resumeCorruptFinalizedPeer.address)
                .request(),
            "HEADLINE: resume must blacklist a peer serving a well-formed-but-provably-invalid payload (finalized-state-hash corruption) - this used to pass with zero punishment"
        ).to.equal(true);

        await expectStillParticipating();
        expect(
            await h.control(victim).stub.wasSpectateAbortCalled().request(),
            "stateManager.abort() must never be reachable from the resume path"
        ).to.equal(false);

        await teardownCorruptFinalized();

        // ==================================================================
        // RESUME PATH, second provable variant (genesis state hash
        // corrupted): proves the genesis-check composite classification split
        // (be02-01) - an unsplit/misclassified check would behave
        // differently here.
        // ==================================================================
        await connectAndWait([4]);

        const teardownCorruptGenesis =
            await h.rpcStub.stubSpectateCorruptPayload(
                [4],
                "genesis-state-hash"
            );

        const corruptGenesisResult = await resumeRetryingTransientFailure();

        expect(
            corruptGenesisResult,
            `resume against a peer serving a payload with a corrupted genesis-state hash must fail with reason "invalid-proof" (got ${JSON.stringify(corruptGenesisResult)})`
        ).to.deep.equal({
            status: "failed",
            reason: "invalid-proof",
            retryable: true
        });

        expect(
            await h
                .control(victim)
                .query.isBlacklisted(resumeCorruptGenesisPeer.address)
                .request(),
            "resume must blacklist a peer serving a well-formed-but-provably-invalid payload (genesis-state-hash corruption)"
        ).to.equal(true);

        await expectStillParticipating();
        expect(
            await h.control(victim).stub.wasSpectateAbortCalled().request(),
            "stateManager.abort() must never be reachable from the resume path"
        ).to.equal(false);

        await teardownCorruptGenesis();
    });
});
