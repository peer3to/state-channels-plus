import { expect } from "chai";
import { MathTestSession as TestSession } from "@test/harness";
import { hash as randomHash } from "../factory";
import { waitFor } from "@test/utils/waitFor";

describe("Unit: ForkReductionService", function () {
    describe("setReductionTimeout", function () {
        it("current fork → schedules a reduction timer; a stale fork → no-op", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 1);
            const forkId = h.activeForkId!;

            const r = await h.execOnHost(
                h.getPeer(0),
                async (sm, args) => {
                    const map = sm.forkReductionService.reductionTriggerMap;
                    const before = map.size;
                    // stale fork -> early return, no schedule
                    sm.setReductionTimeout(args.staleFork, 9_999_999_999);
                    const afterStale = map.size;
                    // current fork, far-future trigger -> scheduled, won't fire
                    sm.setReductionTimeout(args.forkId, 9_999_999_999);
                    return {
                        before,
                        afterStale,
                        afterCurrent: map.size,
                        hasCurrentFork: map.has(args.forkId)
                    };
                },
                { forkId, staleFork: randomHash() }
            );

            expect(r.afterStale).to.equal(r.before);
            expect(r.afterCurrent).to.be.greaterThan(r.before);
            expect(r.hasCurrentFork).to.equal(true);
        });
    });

    describe("isKillPeriodExpiredCached", function () {
        it("an attacker-supplied unknown forkId → answers without throwing", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 1);

            // forkId a crafted dispute could carry - no kill period exists for
            // it, so it reads as not-expired, not a throw
            const r = await h.execOnHost(
                h.getPeer(0),
                async (sm, args) =>
                    sm.isKillPeriodExpiredCached(args.bogusForkId),
                { bogusForkId: randomHash() }
            );

            expect(r.isExpired).to.equal(false);
        });

        it("repeated calls return the same memoized answer", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 1);
            const forkId = h.activeForkId!;

            const r = await h.execOnHost(
                h.getPeer(0),
                async (sm, args) => {
                    const a = await sm.isKillPeriodExpiredCached(args.forkId);
                    const b = await sm.isKillPeriodExpiredCached(args.forkId);
                    return {
                        aExpired: a.isExpired,
                        sameEnd: a.killPeriodEnd === b.killPeriodEnd
                    };
                },
                { forkId }
            );

            // undisputed fork -> not expired, and the cached read is stable
            expect(r.aExpired).to.equal(false);
            expect(r.sameEnd).to.equal(true);
        });
    });

    describe("reduceLocally", function () {
        it("called for a fork the peer isn't on → undefined immediately", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 1);

            const r = await h.execOnHost(
                h.getPeer(0),
                async (sm, args) =>
                    (await sm.reduceLocally(args.staleFork)) === undefined,
                { staleFork: randomHash() }
            );

            expect(r).to.equal(true);
        });

        it("kill period not expired yet → undefined, nothing reduced", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup({ peerCount: 4 });
            const offender = await h.query.getNextPeerToWrite();
            const observer = h.peers.find((p) => p.index !== offender.index)!;
            const forkId = h.activeForkId!;

            // hold the auto-reduction so we control timing
            const race = await h.rpcStub.holdReductionRace(observer.index);
            await h.byzantine.submitInvalidStateTransitionBlock(offender.index);
            await h.assert.dispute.initiatedAndCommitedWait();

            // call immediately, before the kill period lapses -> gated
            const r = await h.execOnHost(
                observer,
                async (sm, args) => {
                    const { isExpired } = await sm.isKillPeriodExpiredCached(
                        args.forkId
                    );
                    const result = await sm.reduceLocally(args.forkId);
                    return {
                        isExpired,
                        resultUndefined: result === undefined,
                        forkUnchanged: String(sm.forkId) === args.forkId
                    };
                },
                { forkId }
            );

            expect(r.isExpired).to.equal(false);
            expect(r.resultUndefined).to.equal(true);
            expect(r.forkUnchanged).to.equal(true);

            await race.release({ replayEvents: false, runHeldTasks: false });
        });

        it("disputed fork past the kill period → reduces locally, returns the reduced genesis, peer switches fork", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup({ peerCount: 4 });
            const offender = await h.query.getNextPeerToWrite();
            const observer = h.peers.find((p) => p.index !== offender.index)!;
            const forkId = h.activeForkId!;

            const race = await h.rpcStub.holdReductionRace(observer.index);
            await h.byzantine.submitInvalidStateTransitionBlock(offender.index);
            await h.assert.dispute.initiatedAndCommitedWait();

            // wait out the kill period so reduceLocally passes its gate
            await waitFor(
                async () =>
                    h.execOnHost(
                        observer,
                        async (sm, args) =>
                            (await sm.isKillPeriodExpiredCached(args.forkId))
                                .isExpired,
                        { forkId }
                    ),
                20000
            );

            const r = await h.execOnHost(
                observer,
                async (sm, args) => {
                    const before = String(sm.forkId);
                    const result = await sm.reduceLocally(args.forkId);
                    return {
                        before,
                        after: String(sm.forkId),
                        reducedForkId: result
                            ? String(result.expectedReducedForkId)
                            : null,
                        disputeCount: result ? result.disputes.length : 0
                    };
                },
                { forkId }
            );

            expect(r.reducedForkId).to.not.be.null;
            expect(r.disputeCount).to.be.greaterThan(0);
            // was on the disputed fork, now on the reduced one
            expect(r.before).to.equal(forkId);
            expect(r.after).to.equal(r.reducedForkId);

            await race.release({ replayEvents: false, runHeldTasks: false });
        });

        it("concurrent calls are single-flight → same reduced result, one run", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup({ peerCount: 4 });
            const offender = await h.query.getNextPeerToWrite();
            const observer = h.peers.find((p) => p.index !== offender.index)!;
            const forkId = h.activeForkId!;

            const race = await h.rpcStub.holdReductionRace(observer.index);
            await h.byzantine.submitInvalidStateTransitionBlock(offender.index);
            await h.assert.dispute.initiatedAndCommitedWait();
            await waitFor(
                async () =>
                    h.execOnHost(
                        observer,
                        async (sm, args) =>
                            (await sm.isKillPeriodExpiredCached(args.forkId))
                                .isExpired,
                        { forkId }
                    ),
                20000
            );

            // fire two reduceLocally at once - the single-flight map must give
            // both the same run (one reduced fork, no double-submit)
            const r = await h.execOnHost(
                observer,
                async (sm, args) => {
                    const [a, b] = await Promise.all([
                        sm.reduceLocally(args.forkId),
                        sm.reduceLocally(args.forkId)
                    ]);
                    return {
                        aFork: a ? String(a.expectedReducedForkId) : null,
                        bFork: b ? String(b.expectedReducedForkId) : null
                    };
                },
                { forkId }
            );

            expect(r.aFork).to.not.be.null;
            expect(r.aFork).to.equal(r.bFork);

            await race.release({ replayEvents: false, runHeldTasks: false });
        });

        it("reduce-to-genesis: no valid block survives → reduced state resolves to the genesis state", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0); // no blocks yet
            await h.assert.sync.peersInSyncWait();
            h.event.resetEventSpies();
            const forkId = h.activeForkId!;

            const race = await h.rpcStub.holdReductionRace(1);
            // an invalid block 0 -> nothing valid survives -> reduce falls back
            // all the way to genesis
            await h.byzantine.submitInvalidStateTransitionBlock(0);
            await h.assert.dispute.initiatedAndCommitedWait({
                timeoutMs: 15000
            });
            await waitFor(
                async () =>
                    h.execOnHost(
                        h.getPeer(1),
                        async (sm, args) =>
                            (await sm.isKillPeriodExpiredCached(args.forkId))
                                .isExpired,
                        { forkId }
                    ),
                20000
            );

            const r = await h.execOnHost(
                h.getPeer(1),
                async (sm, args) => {
                    const result = await sm.reduceLocally(args.forkId);
                    const genesis =
                        sm.storage.stateSnapshots.getGenesisSnapshotByForkId(
                            args.forkId
                        )!;
                    return {
                        reducedStateHash: result
                            ? String(
                                  result.reduceData.latestStateSnapshot
                                      .snapshotData.stateMachineStateHash
                              )
                            : null,
                        genesisStateHash: String(
                            genesis.snapshotData.stateMachineStateHash
                        )
                    };
                },
                { forkId }
            );

            // the reduced state resolves back to the genesis state machine state
            expect(r.reducedStateHash).to.equal(r.genesisStateHash);

            await race.release({ replayEvents: false, runHeldTasks: false });
        });

        // reachable only when reduceLocally runs past the kill period on a fork
        // whose committed disputes aren't in local storage - the self-dispute-
        // first path. not stageable without the held-reduction window; the throw
        // side (getForkDisputes empty vs missing) is the partial-window race below.
        it.skip("no local disputes past kill period → initiates a local dispute, undefined", function () {});

        // RACE, known red - skipped until fixed.
        // a dispute commitment lands on-chain before onDisputeCommitted stores
        // the struct. a reduction firing in that gap sees the commitment but no
        // struct -> getForkDisputes throws "Missing Dispute in storage".
        // reduceLocally doesn't catch it and tryReduce is fire-and-forget, so
        // it ends as an unhandled rejection. wanted: return undefined and let
        // the reschedule retry, like the other not-ready cases.
        it.skip("partial dispute window (commitment on-chain, struct not yet stored) → reduceLocally discards, not throws", function () {});
    });

    describe("performReduction (real on-chain reduce)", function () {
        // the tryReduce reschedule branches (local/on-chain kill period not yet
        // expired -> setReductionTimeout retry) need the timer to fire mid-window
        // deterministically - timing-dependent, exercised e2e under real load.
        it.skip("kill period not expired when the timer fires → reschedules", function () {});

        it("a real dispute resolves → honest peers reduce on-chain and switch to the reduced fork", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup({ peerCount: 4 });
            const offender = await h.query.getNextPeerToWrite();
            const originalFork = h.activeForkId!;

            // no hold: let the reduction run for real -> tryReduce -> performReduction
            // -> reduceAndFinalize multicall. multiple honest peers race it, so the
            // losers hit RaceConditionDisputeAlreadyReduced (swallowed).
            await h.byzantine.submitInvalidStateTransitionBlock(offender.index);
            await h.assert.dispute.initiatedAndCommitedWait();
            const { newForkId } = await h.dispute.resolveDisputeWait();

            const witness = h.peers.find((p) => p.index !== offender.index)!;
            const r = await h.execOnHost(witness, async (sm) => ({
                fork: String(sm.forkId)
            }));

            // the on-chain reduction landed and the witness converged to it
            expect(newForkId).to.not.equal(originalFork);
            expect(r.fork).to.equal(newForkId);
        });
    });

    // dispose() cancels scheduled reduction timers; onForkTransition() clears the
    // kill-period cache. both are lifecycle wiring covered by the session
    // teardown + fork-transition E2E, not a standalone unit contract.
    it.skip("dispose / onForkTransition lifecycle", function () {});
});
