import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";

/**
 * COVERAGE BOUNDARY - read before touching this file.
 *
 * PROVES:
 *  1. resumeFromBackground's internal ordering hydrates storage strictly
 *     before it (attempts to) rejoin transport. Proven via host-side
 *     instrumentation on the resuming peer's own `storage.hydrate` and
 *     `p2pManager.tryOpenConnectionToChannel`, because the real transport
 *     call is a documented no-op under this harness (see point 2) and can't
 *     be observed any other way.
 *  2. a peer whose connections were torn down actually re-establishes them
 *     via the harness's real connect/reconnect path and catches up on state
 *     authored on the surviving peer while it was disconnected.
 *  3. phase-hook ordering, via the `onResumePhase` event spy.
 *  4. the full `ResumeResult` shape, both for a resume that genuinely had to
 *     catch up ({status:"restored", localWasAhead:false}) and one where
 *     local storage was already current ({status:"restored",
 *     localWasAhead:true}).
 *  5. the resumed peer can author the next state transition afterward and
 *     both peers converge on it.
 *
 * DOES NOT PROVE:
 *  - a real Holepunch swarm rejoin. `P2PManager.tryOpenConnectionToChannel`
 *    is a documented no-op under this Node test harness
 *    (`DEBUG_LOCAL_TRANSPORT && isNodeRuntime()` - see P2PManager.ts), so
 *    "transport recovery" below is driven entirely by the harness's own
 *    `network.connectPeers`/`LocalDiscoveryServer` reconnect primitive, not
 *    by resume's own transport-rejoin call. A genuine swarm rejoin is not
 *    covered by any Node E2E in this repo and is a known gap.
 *  - topic-registration idempotency on repeated joins - that's covered at
 *    the unit level (Holepunch.ts).
 *
 * Every scenario below runs inside ONE harness session/`it`: this sandbox
 * cannot stand up a second full peer session in the same mocha process (a
 * second session hangs at a deploy-transaction timeout) - see
 * test/e2e/persistence/durabilityBarrier.test.ts and
 * test/e2e/E2E-ResumePeerRotation.test.ts for the same constraint and the
 * same single-session-for-everything structure.
 */
describe("E2E: resume from background", function () {
    it("hydrates before transport rejoin, reconnects and catches up on state authored while away, fires phase hooks in order, and reports the full ResumeResult for both a genuine catch-up and an already-current resume", async function () {
        this.timeout(120000);

        const h = TestSession.getHarness();
        // resume budget = 50% of (p2p + agreement + chainFallback) = 6s -
        // enough for hydrate + a no-op transport call + one real spectate
        // round trip, without making the test slow.
        await h.lifecycle.start(2, 0, {
            timeConfig: {
                p2pTime: 1,
                agreementTime: 10,
                chainFallbackTime: 1,
                evidenceTime: 4
            }
        });

        const forkId = h.activeForkId!;

        // Don't assume which participant writes first - discover it. The
        // peer already holding the turn authors the "while away" block; the
        // other one is backgrounded untouched (never having authored
        // anything itself keeps the "genuinely behind" scenario below
        // unambiguous - see the note at the resume call).
        const nextWriterIndex = (await h.query.getNextPeerToWrite()).index;
        const onlyPeer = h.getPeer(nextWriterIndex);
        const resuming = h.getPeer(nextWriterIndex === 0 ? 1 : 0);

        // ==================================================================
        // Background the resuming peer, then have the surviving peer author
        // state while it's gone.
        // ==================================================================
        await h.network.disconnectPeer(resuming.index);

        await h.transition.submit(onlyPeer, (contract) => contract.add(1), {
            waitForTurn: true,
            waitForPeers: [onlyPeer.index],
            waitForFinalization: false
        });

        const authoredWhileAwayHash = await h
            .control(onlyPeer)
            .query.getLatestBlockHash(forkId)
            .request();
        expect(
            authoredWhileAwayHash,
            "the surviving peer must have authored a new block while the resuming peer was disconnected"
        ).to.not.be.null;

        const staleHashBeforeResume = await h
            .control(resuming)
            .query.getLatestBlockHash(forkId)
            .request();
        expect(
            staleHashBeforeResume,
            "precondition: the resuming peer's storage must predate the block authored while it was away"
        ).to.not.equal(authoredWhileAwayHash);

        // Reconnect via the harness's REAL connect path - resume's own
        // transport rejoin is a documented no-op under this harness (see the
        // coverage-boundary comment above). InitHandshakeService only fires
        // its OWN automatic reactive sync while `stateManager.getStatus()`
        // is still `Status.OPENED` (i.e. immediately after channel-open,
        // before any transition has run) - by this point in the scenario
        // both peers are well past that into PARTICIPATING/SYNCED, so this
        // reconnect does not race any automatic sync; the catch-up below is
        // unambiguously resumeFromBackground's own doing.
        await h.network.connectPeers([resuming.index]);
        await h.network.waitForP2PConnections();

        // FR1 ordering instrumentation, installed AFTER the harness's own
        // reconnect (which itself calls tryOpenConnectionToChannel once, a
        // no-op) so only resumeFromBackground's OWN calls are recorded.
        // Mirrors test/e2e/persistence/durabilityBarrier.test.ts's technique
        // (host-side method wrapping): wrap both methods, push into a
        // per-signer-keyed array on globalThis (inline mode shares one
        // process/globalThis across peers), read it back host-side.
        await h.execOnHost(resuming, (sm) => {
            const g = globalThis as unknown as {
                __resumeOrder?: Record<string, string[]>;
            };
            g.__resumeOrder = g.__resumeOrder ?? {};
            const events: string[] = [];
            g.__resumeOrder[String(sm.signerAddress)] = events;

            const storage = sm.storage;
            const origHydrate = storage.hydrate.bind(storage);
            storage.hydrate = () => {
                events.push("hydrate");
                return origHydrate();
            };

            const p2p = sm.p2pManager;
            const origJoin = p2p.tryOpenConnectionToChannel.bind(p2p);
            p2p.tryOpenConnectionToChannel = (channelId) => {
                events.push("join");
                return origJoin(channelId);
            };
            return true;
        });

        // `localWasAhead` reflects whether local storage already proved the
        // latest FINALIZED snapshot (SpectateService.persistSyncPayload) -
        // not merely "already had the peer's live block". Since `resuming`
        // never authored anything itself, it's still exactly at the fork's
        // genesis snapshot going into this call, so this is unambiguously
        // the "genuinely behind" case.
        const result = await resuming.p2pInstance.resumeFromBackground();

        expect(
            result,
            `resume must report the exact catch-up state when it was genuinely behind (got ${JSON.stringify(result)})`
        ).to.deep.equal({ status: "restored", localWasAhead: false });

        // ---- FR1: hydrate must run before the transport rejoin ----
        const orderRec = await h.execOnHost<string[]>(resuming, (sm) => {
            const g = globalThis as unknown as {
                __resumeOrder?: Record<string, string[]>;
            };
            return g.__resumeOrder?.[String(sm.signerAddress)] ?? [];
        });
        const hydrateIdx = orderRec.indexOf("hydrate");
        const joinIdx = orderRec.indexOf("join");
        expect(
            hydrateIdx,
            "resumeFromBackground must call storage.hydrate"
        ).to.be.greaterThanOrEqual(0);
        expect(
            joinIdx,
            "resumeFromBackground must call tryOpenConnectionToChannel"
        ).to.be.greaterThanOrEqual(0);
        expect(
            hydrateIdx,
            "hydrate must run before transport rejoin"
        ).to.be.lessThan(joinIdx);

        // ---- phase hooks fired in order for this resume ----
        const phases = resuming.eventSpies
            .onResumePhase!.getCalls()
            .map((call) => call.args[0]);
        expect(
            phases,
            `phase hooks must fire in order [reconnecting, resyncing] (got ${JSON.stringify(phases)})`
        ).to.deep.equal(["reconnecting", "resyncing"]);

        // ---- storage catch-up: resuming peer now holds the block authored
        // while it was away ----
        const hashAfterResume = await h
            .control(resuming)
            .query.getLatestBlockHash(forkId)
            .request();
        expect(
            hashAfterResume,
            "resumed peer's storage must hold the block authored while it was away"
        ).to.equal(authoredWhileAwayHash);

        // ==================================================================
        // Second sub-scenario, same session: resume again immediately with
        // nothing new authored - local storage is already current.
        // ==================================================================
        resuming.eventSpies.onResumePhase!.resetHistory();
        const alreadyCurrentResult =
            await resuming.p2pInstance.resumeFromBackground();
        expect(
            alreadyCurrentResult,
            `resume with nothing new to catch up on must report already-current (got ${JSON.stringify(alreadyCurrentResult)})`
        ).to.deep.equal({ status: "restored", localWasAhead: true });

        // ---- the resumed peer can author the next transition successfully
        // afterward, and both peers converge on it ----
        await h.transition.submit(resuming, (contract) => contract.add(1), {
            waitForTurn: true,
            waitForSync: true
        });

        const resumingTip = await h
            .control(resuming)
            .query.getLatestBlockHash(forkId)
            .request();
        const onlyPeerTip = await h
            .control(onlyPeer)
            .query.getLatestBlockHash(forkId)
            .request();
        expect(
            resumingTip,
            "the resumed peer's authored transition must converge on both peers' live state"
        ).to.equal(onlyPeerTip);
    });
});
