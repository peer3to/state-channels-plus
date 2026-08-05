import { expect } from "chai";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";

/**
 * Proves the peer-rotation starvation fix (RO2) with a deterministic
 * multi-peer scenario a single-peer resume test structurally cannot catch:
 * a candidate that's genuinely busy (a real in-flight sync collision, staged
 * via the hold fixture so it's deterministic rather than timing luck) must
 * not starve a healthy candidate further back in the rotation queue.
 *
 * All sub-scenarios (RO2 headline proof, ordinary-failure exclusion,
 * candidate-set exhaustion) run inside ONE harness session/`it`: this repo's
 * harness cannot stand up a second full peer session in the same process (see
 * test/e2e/persistence/durabilityBarrier.test.ts for the same constraint and
 * rationale), so they're sequenced within a single session rather than split
 * across `it`s that would each re-`start()`.
 *
 * `MAX_RESUME_SYNC_PEERS` (src/P2PManager.ts) is 3, so the exhaustion
 * scenario needs exactly 3 fresh failing candidates. Peers are introduced to
 * the mesh incrementally (`autoConnect: false` + staged `connectPeers`) so
 * each scenario's candidate queue is exactly the peer set it's testing -
 * a healthy leftover connection from an earlier scenario would let resume
 * succeed on the wrong candidate and silently short-circuit the proof.
 */
describe("E2E: resume peer rotation (RO2)", function () {
    it("rotates through candidates without starving a healthy peer behind a busy one; excludes ordinary failures permanently; reports the real reason on exhaustion", async function () {
        this.timeout(120000);

        const h = TestSession.getHarness();
        // resume budget = 50% of (p2p + agreement + chainFallback) = 6s -
        // short enough to keep the test fast, long enough for several
        // sequential rotation attempts (each near-instant on the in-process
        // transport) plus the fixed 500ms inter-attempt switch delay.
        await h.lifecycle.start(8, 0, {
            autoConnect: false,
            timeConfig: {
                p2pTime: 1,
                agreementTime: 10,
                chainFallbackTime: 1,
                evidenceTime: 4
            }
        });

        const resuming = h.getPeer(0);
        const peerA = h.getPeer(1);
        const peerB = h.getPeer(2);
        const peerC = h.getPeer(3);
        const peerD = h.getPeer(4);
        const peerE1 = h.getPeer(5);
        const peerE2 = h.getPeer(6);
        const peerE3 = h.getPeer(7);

        /** Connects the given peer indices to the mesh and waits until the
         * resuming peer sees each non-zero index as connected. */
        async function connectAndWait(indices: number[]): Promise<void> {
            await h.network.connectPeers(indices);
            const toCheck = indices.filter((i) => i !== 0);
            await Promise.all(
                toCheck.map((i) =>
                    waitFor(
                        () =>
                            h
                                .control(resuming)
                                .query.isConnectedTo(h.getPeer(i).address)
                                .request(),
                        10000
                    )
                )
            );
        }

        /** Disconnects the resuming peer's connection toward `address` and
         * confirms it's gone from its candidate set. */
        async function disconnectFromResuming(address: string): Promise<void> {
            await h
                .control(resuming)
                .network.disconnectPeerByAddress(address)
                .request();
            const stillConnected = await h
                .control(resuming)
                .query.isConnectedTo(address)
                .request();
            expect(
                stillConnected,
                `expected ${address} to be disconnected from the resuming peer`
            ).to.equal(false);
        }

        /** Reciprocal-blacklist guard: the resuming peer must never end up
         * blacklisted BY a candidate it contacted, in any scenario. */
        async function assertNotBlacklistedByCandidate(
            candidate: typeof peerA
        ): Promise<void> {
            const blacklisted = await h
                .control(candidate)
                .query.isBlacklisted(resuming.address)
                .request();
            expect(
                blacklisted,
                `candidate ${candidate.address} must not blacklist the resuming peer`
            ).to.equal(false);
        }

        // ==================================================================
        // RO2 PROOF: a genuinely busy candidate (peer A, a real in-flight
        // sync collision on the resuming peer's OWN spectateService) must not
        // starve a healthy candidate (peer B) behind it in the queue.
        //
        // The "collision" is staged deterministically, not via timing: a
        // manual sync from the resuming peer toward A, targeting a DIFFERENT
        // sync target (an explicit forkId/height) than resume's own
        // (undefined/undefined = "latest") request. That guarantees resume's
        // own syncAwaitable(A) call - if the rotation ever reaches A - hits
        // `!sameTarget` and resolves 'in-flight-collision' immediately (no
        // second RPC to A), rather than actually blocking. The hold fixture
        // on A's onSpectateRequest keeps that manual sync's underlying RPC
        // pending for the whole scenario, so A's in-flight entry (and hence
        // the collision precondition) stays live regardless of which
        // candidate resume's rotation visits first.
        // ==================================================================
        await connectAndWait([0, 1, 2]);

        // Hold installed BEFORE the counter so the counter wraps the hold
        // (increments synchronously at request entry, before the hold
        // blocks) rather than the counter being wrapped BY the hold (which
        // would only increment after release) - see be02-07's dedicated
        // StubKey composition contract.
        const heldA = await h.rpcStub.holdSpectateRequest(1);
        const teardownCountA = await h.rpcStub.stubCountSpectateRequests(1);
        const teardownCountB = await h.rpcStub.stubCountSpectateRequests(2);

        const collisionForkId = h.activeForkId!;
        await h
            .control(resuming)
            .spectate.startSync(peerA.address, collisionForkId, 0)
            .request();

        await waitFor(async () => (await heldA.status()).entered, 5000);

        const aCountBeforeResume = await h.rpcStub.getSpectateRequestCount(1);
        const bCountBeforeResume = await h.rpcStub.getSpectateRequestCount(2);
        expect(
            aCountBeforeResume,
            "precondition: A's only request so far is the staged manual sync"
        ).to.equal(1);
        expect(
            bCountBeforeResume,
            "precondition: B has not been contacted yet"
        ).to.equal(0);

        const ro2Result = await resuming.p2pInstance.resumeFromBackground();

        // A must still be held (not released) at this point - proves B was
        // reached and resume completed WHILE A's request was still
        // outstanding, not after A eventually gave up/timed out.
        const heldAStatusAfterResume = await heldA.status();
        expect(
            heldAStatusAfterResume,
            "A must still be held when resume completes - starvation would only be disproven if B ran concurrently with A's still-pending request"
        ).to.deep.equal({ entered: true, released: false, settled: false });

        const aCountAfterResume = await h.rpcStub.getSpectateRequestCount(1);
        const bCountAfterResume = await h.rpcStub.getSpectateRequestCount(2);

        // SEQUENCING: A's count is unchanged by resume's own attempt (its
        // syncAwaitable call against A - if reached at all - resolves the
        // collision locally without ever sending a second RPC), and B's
        // count moved from 0 to exactly 1, i.e. no two requests were ever
        // outstanding at once.
        expect(
            aCountAfterResume,
            "A must not be re-contacted by resume's own attempt - a collision is resolved locally, not by another RPC"
        ).to.equal(1);
        expect(
            bCountAfterResume,
            "B must have been contacted exactly once by resume"
        ).to.equal(1);

        expect(
            ro2Result,
            `resume must succeed via B despite A being held (got ${JSON.stringify(ro2Result)})`
        ).to.deep.equal({ status: "restored", localWasAhead: false });

        await assertNotBlacklistedByCandidate(peerA);
        await assertNotBlacklistedByCandidate(peerB);

        // Cleanup: LIFO relative to install order (count wraps hold, so
        // remove count first) - otherwise restoring the hold would
        // reintroduce the count layer via its stale captured original.
        await teardownCountA();
        await heldA.restore();
        await teardownCountB();

        // Isolate the next scenario's candidate queue: A and B are healthy
        // and would otherwise still be viable (and order-nondeterministic)
        // candidates for resume's next call.
        await disconnectFromResuming(peerA.address);
        await disconnectFromResuming(peerB.address);

        // ==================================================================
        // ORDINARY (non-collision) FAILURE: C fails with a peer-provable,
        // non-collision reason (a real sync payload with one field
        // corrupted - "invalid-proof"). Confirms C is excluded permanently
        // (never retried, even across a later, separate resume call) while a
        // healthy candidate (D) succeeds.
        // ==================================================================
        await connectAndWait([3]);

        const teardownCorruptC = await h.rpcStub.stubSpectateCorruptPayload(
            [3],
            "genesis-state-hash"
        );
        const teardownCountC = await h.rpcStub.stubCountSpectateRequests(3);

        const ordinaryFailResult =
            await resuming.p2pInstance.resumeFromBackground();

        expect(
            ordinaryFailResult,
            `resume must fail with the real peer-provable reason when its only candidate serves a corrupt payload (got ${JSON.stringify(ordinaryFailResult)})`
        ).to.deep.equal({
            status: "failed",
            reason: "invalid-proof",
            retryable: true
        });

        const cCountAfterFirstCall = await h.rpcStub.getSpectateRequestCount(3);
        expect(
            cCountAfterFirstCall,
            "C must be contacted exactly once - an ordinary failure is not retried"
        ).to.equal(1);

        await assertNotBlacklistedByCandidate(peerC);

        await connectAndWait([4]);

        const secondResult = await resuming.p2pInstance.resumeFromBackground();

        expect(
            secondResult,
            `resume must succeed via D on the next call, with C permanently excluded (got ${JSON.stringify(secondResult)})`
        ).to.deep.equal({ status: "restored", localWasAhead: false });

        const cCountAfterSecondCall =
            await h.rpcStub.getSpectateRequestCount(3);
        expect(
            cCountAfterSecondCall,
            "C must still not have been retried, even across a separate later resume call"
        ).to.equal(1);

        await assertNotBlacklistedByCandidate(peerC);
        await assertNotBlacklistedByCandidate(peerD);

        await teardownCorruptC();
        await teardownCountC();
        await disconnectFromResuming(peerD.address);

        // ==================================================================
        // EXHAUSTION: all MAX_RESUME_SYNC_PEERS (3) candidates fail with the
        // same ordinary, peer-provable reason. Resume must report FAILED
        // carrying that real reason (not a generic/deadline reason) and
        // retryable:true - and every candidate must have been given exactly
        // one attempt.
        // ==================================================================
        await connectAndWait([5, 6, 7]);

        const teardownCorruptE = await h.rpcStub.stubSpectateCorruptPayload(
            [5, 6, 7],
            "genesis-state-hash"
        );
        const teardownCountE1 = await h.rpcStub.stubCountSpectateRequests(5);
        const teardownCountE2 = await h.rpcStub.stubCountSpectateRequests(6);
        const teardownCountE3 = await h.rpcStub.stubCountSpectateRequests(7);

        const exhaustionResult =
            await resuming.p2pInstance.resumeFromBackground();

        expect(
            exhaustionResult,
            `resume must fail carrying the last attempt's real reason once every candidate is exhausted (got ${JSON.stringify(exhaustionResult)})`
        ).to.deep.equal({
            status: "failed",
            reason: "invalid-proof",
            retryable: true
        });

        const e1Count = await h.rpcStub.getSpectateRequestCount(5);
        const e2Count = await h.rpcStub.getSpectateRequestCount(6);
        const e3Count = await h.rpcStub.getSpectateRequestCount(7);
        expect(
            [e1Count, e2Count, e3Count],
            "every one of the 3 distinct candidates must have been tried exactly once"
        ).to.deep.equal([1, 1, 1]);

        await assertNotBlacklistedByCandidate(peerE1);
        await assertNotBlacklistedByCandidate(peerE2);
        await assertNotBlacklistedByCandidate(peerE3);

        await teardownCorruptE();
        await teardownCountE1();
        await teardownCountE2();
        await teardownCountE3();
    });
});
