import { expect } from "chai";
import sinon from "sinon";

import P2PManager, { ResumeResult } from "@/P2PManager";
import type {
    SyncOutcome,
    SyncFailReason
} from "@/rpc/services/spectate/SpectateService";

/**
 * Component-level coverage of P2PManager.resumeFromBackground()'s
 * orchestration logic: in-flight dedup, phase-hook ordering, the
 * hydrate-before-transport ordering guarantee, the resume-window
 * enter/exit interlock, deadline-bounded peer rotation, and the
 * dispose interlock.
 *
 * No harness/session, no live channel, no real transport/storage - every
 * collaborator P2PManager touches during a resume is a sinon stub. The
 * instance itself is built via Object.create(P2PManager.prototype) rather
 * than `new P2PManager(...)`, since the real constructor needs a full
 * StateManager/signer/RPC wiring this suite deliberately avoids.
 */

function okOutcome(
    overrides: Partial<{
        confirmedForkId: unknown;
        confirmedHeight: unknown;
        localWasAhead: boolean;
    }> = {}
): SyncOutcome {
    return {
        ok: true,
        confirmedForkId: "fork-1" as any,
        confirmedHeight: 1 as any,
        localWasAhead: false,
        ...overrides
    } as SyncOutcome;
}

function failOutcome(reason: SyncFailReason): SyncOutcome {
    return { ok: false, reason };
}

interface ManagerHandle {
    instance: P2PManager;
    hydrateStub: sinon.SinonStub;
    transportStub: sinon.SinonStub;
    getConnectedPeersStub: sinon.SinonStub;
    syncAwaitableStub: sinon.SinonStub;
    enterResumeWindowStub: sinon.SinonStub;
    exitResumeWindowStub: sinon.SinonStub;
    onResumePhaseStub: sinon.SinonStub;
    getTimeoutWaitTimeSecondsStub: sinon.SinonStub;
    holepunchDisposeStub: sinon.SinonStub;
}

/**
 * Builds a P2PManager instance with every collaborator resumeFromBackground()
 * touches stubbed out. `budgetSeconds` feeds getTimeoutWaitTimeSeconds(1),
 * which (via RESUME_BUDGET_FRACTION = 0.5) becomes the resume's total time
 * budget in ms: totalBudgetMs = budgetSeconds * 1000 * 0.5.
 */
function createManager(budgetSeconds = 20): ManagerHandle {
    const instance: any = Object.create(P2PManager.prototype);

    const hydrateStub = sinon.stub().resolves();
    const enterResumeWindowStub = sinon.stub();
    const exitResumeWindowStub = sinon.stub();
    const syncAwaitableStub = sinon.stub().resolves(okOutcome());
    const onResumePhaseStub = sinon.stub();
    const getTimeoutWaitTimeSecondsStub = sinon.stub().returns(budgetSeconds);
    const getChannelIdStub = sinon.stub().returns("test-channel");
    const holepunchDisposeStub = sinon.stub().resolves();

    instance.stateManager = {
        getChannelId: getChannelIdStub,
        getTimeoutWaitTimeSeconds: getTimeoutWaitTimeSecondsStub,
        p2pEventHooks: { onResumePhase: onResumePhaseStub },
        storage: { hydrate: hydrateStub }
    };
    instance.logger = {
        debug: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        info: () => undefined,
        verbose: () => undefined,
        child() {
            return this;
        }
    };
    instance.localRpc = {
        spectateService: {
            enterResumeWindow: enterResumeWindowStub,
            exitResumeWindow: exitResumeWindowStub,
            syncAwaitable: syncAwaitableStub
        }
    };
    instance.holepunch = { dispose: holepunchDisposeStub };
    instance.openConnections = [];
    instance.disposed = false;
    instance.resumeInFlight = undefined;
    instance.disposalPromise = undefined;

    const transportStub = sinon
        .stub(instance, "tryOpenConnectionToChannel")
        .resolves();
    const getConnectedPeersStub = sinon
        .stub(instance, "getConnectedPeers")
        .returns(new Set(["0xPeer1"]));

    return {
        instance: instance as P2PManager,
        hydrateStub,
        transportStub,
        getConnectedPeersStub,
        syncAwaitableStub,
        enterResumeWindowStub,
        exitResumeWindowStub,
        onResumePhaseStub,
        getTimeoutWaitTimeSecondsStub,
        holepunchDisposeStub
    };
}

describe("P2PManager.resumeFromBackground", function () {
    it("dedups concurrent calls to the same in-flight promise and runs the underlying resume exactly once", async function () {
        const { instance, hydrateStub, transportStub, syncAwaitableStub } =
            createManager();

        const p1 = instance.resumeFromBackground();
        const p2 = instance.resumeFromBackground();

        expect(
            p1,
            "concurrent resumeFromBackground() calls must dedup to the SAME promise"
        ).to.equal(p2);

        await p1;

        expect(
            hydrateStub.callCount,
            "hydrate-ordering: hydrate must run exactly once across both dedup'd calls"
        ).to.equal(1);
        expect(
            transportStub.callCount,
            "hydrate-ordering: transport rejoin must run exactly once across both dedup'd calls"
        ).to.equal(1);
        expect(
            syncAwaitableStub.callCount,
            "peer-rotation: sync must run exactly once across both dedup'd calls"
        ).to.equal(1);
    });

    it("fires onResumePhase('reconnecting') then ('resyncing') in order on a successful resume", async function () {
        const { instance, onResumePhaseStub } = createManager();

        const result = await instance.resumeFromBackground();

        expect(
            result.status,
            "successful resume should report status 'restored'"
        ).to.equal("restored");
        const phases = onResumePhaseStub.getCalls().map((c) => c.args[0]);
        expect(
            phases,
            "deadline-budget/phase-hook ordering: 'reconnecting' must fire before 'resyncing'"
        ).to.deep.equal(["reconnecting", "resyncing"]);
    });

    it("returns {status:'failed', reason:'transport'} when the transport rejoin rejects, and never fires 'resyncing'", async function () {
        const { instance, transportStub, onResumePhaseStub } = createManager();
        transportStub.rejects(new Error("transport rejoin boom"));

        const result = await instance.resumeFromBackground();

        expect(
            result,
            "failure-reason-fidelity: a rejected transport rejoin must surface reason 'transport'"
        ).to.deep.equal({
            status: "failed",
            reason: "transport",
            retryable: true
        } satisfies ResumeResult);
        expect(
            onResumePhaseStub.calledWith("resyncing"),
            "hydrate-ordering: 'resyncing' must never fire if the transport rejoin failed"
        ).to.equal(false);
    });

    it("returns {status:'failed', reason:'hydration-failed'} when storage.hydrate() rejects, never fires 'resyncing', and never attempts the transport rejoin", async function () {
        const { instance, hydrateStub, transportStub, onResumePhaseStub } =
            createManager();
        hydrateStub.rejects(new Error("hydrate boom"));

        const result = await instance.resumeFromBackground();

        expect(
            result,
            "failure-reason-fidelity: a rejected hydrate must surface reason 'hydration-failed'"
        ).to.deep.equal({
            status: "failed",
            reason: "hydration-failed",
            retryable: true
        } satisfies ResumeResult);
        expect(
            onResumePhaseStub.calledWith("resyncing"),
            "hydrate-ordering: 'resyncing' must never fire if hydrate failed"
        ).to.equal(false);
        expect(
            transportStub.called,
            "hydrate-ordering: the transport rejoin must never be attempted when hydrate fails first"
        ).to.equal(false);
    });

    it("returns {status:'failed', reason:'no-peers'} with zero connected peers, and never calls sync", async function () {
        const { instance, getConnectedPeersStub, syncAwaitableStub } =
            createManager();
        getConnectedPeersStub.returns(new Set());

        const result = await instance.resumeFromBackground();

        expect(
            result,
            "peer-rotation: zero connected peers must fail with reason 'no-peers'"
        ).to.deep.equal({
            status: "failed",
            reason: "no-peers",
            retryable: true
        } satisfies ResumeResult);
        expect(
            syncAwaitableStub.called,
            "peer-rotation: sync must never be attempted with zero connected peers"
        ).to.equal(false);
    });

    describe("in-flight state is cleared after every terminal outcome, so a subsequent call starts a genuinely new resume", function () {
        it("after a successful resume", async function () {
            const { instance, hydrateStub } = createManager();

            const r1 = await instance.resumeFromBackground();
            expect(r1.status).to.equal("restored");
            expect(
                (instance as any).resumeInFlight,
                "dedup state must be cleared after a successful resume"
            ).to.equal(undefined);

            const p2 = instance.resumeFromBackground();
            await p2;
            expect(
                hydrateStub.callCount,
                "a subsequent call after success must run a fresh resume (hydrate called again), not reuse the old cached promise"
            ).to.equal(2);
        });

        it("after a transport failure", async function () {
            const { instance, hydrateStub, transportStub } = createManager();
            transportStub.rejects(new Error("boom"));

            await instance.resumeFromBackground();
            expect(
                (instance as any).resumeInFlight,
                "dedup state must be cleared after a transport failure"
            ).to.equal(undefined);

            await instance.resumeFromBackground();
            expect(
                hydrateStub.callCount,
                "a subsequent call after a transport failure must start a genuinely new resume"
            ).to.equal(2);
        });

        it("after a hydration failure", async function () {
            const { instance, hydrateStub } = createManager();
            hydrateStub.rejects(new Error("boom"));

            await instance.resumeFromBackground();
            expect(
                (instance as any).resumeInFlight,
                "dedup state must be cleared after a hydration failure"
            ).to.equal(undefined);

            await instance.resumeFromBackground();
            expect(
                hydrateStub.callCount,
                "a subsequent call after a hydration failure must start a genuinely new resume"
            ).to.equal(2);
        });

        it("after a no-peers failure", async function () {
            const { instance, hydrateStub, getConnectedPeersStub } =
                createManager();
            getConnectedPeersStub.returns(new Set());

            await instance.resumeFromBackground();
            expect(
                (instance as any).resumeInFlight,
                "dedup state must be cleared after a no-peers failure"
            ).to.equal(undefined);

            await instance.resumeFromBackground();
            expect(
                hydrateStub.callCount,
                "a subsequent call after a no-peers failure must start a genuinely new resume"
            ).to.equal(2);
        });

        it("after a thrown exception from the sync call", async function () {
            const { instance, hydrateStub, syncAwaitableStub } =
                createManager();
            syncAwaitableStub.rejects(new Error("sync exploded"));

            const result = await instance.resumeFromBackground();
            expect(result.status).to.equal("failed");
            expect(
                (instance as any).resumeInFlight,
                "dedup state must be cleared after a thrown sync exception"
            ).to.equal(undefined);

            await instance.resumeFromBackground();
            expect(
                hydrateStub.callCount,
                "a subsequent call after a thrown sync exception must start a genuinely new resume"
            ).to.equal(2);
        });
    });

    describe("fake-timer deadline/timeout boundaries", function () {
        let clock: sinon.SinonFakeTimers;

        afterEach(function () {
            clock?.restore();
        });

        it("fails without launching any sync attempt if the deadline has already passed by the time rotation would start", async function () {
            clock = sinon.useFakeTimers();
            // budgetSeconds = 0 -> totalBudgetMs = 0, so by the time
            // resyncWithPeerSwitch's own `Date.now() < deadline` check runs,
            // the deadline is already (exactly) elapsed. Since hydrate and
            // the transport rejoin resolve purely via microtasks (the clock
            // is never ticked), no real time passes before that check.
            //
            // MF-3 fix note: the peer-rotation loop no longer distinguishes
            // "candidates were available but the deadline beat the first
            // attempt" from "no candidate was ever available" - both
            // collapse to zero attempts launched, which is reported as
            // 'no-peers' (not 'deadline-expired') per the corrected
            // contract: 'no-peers' is returned whenever the window closes
            // with zero attempts ever launched.
            const { instance, syncAwaitableStub } = createManager(0);

            const result = await instance.resumeFromBackground();

            expect(
                result,
                "deadline-budget: an already-expired deadline with zero attempts launched must fail with reason 'no-peers'"
            ).to.deep.equal({
                status: "failed",
                reason: "no-peers",
                retryable: true
            } satisfies ResumeResult);
            expect(
                syncAwaitableStub.called,
                "deadline-budget: no sync attempt may be launched once the deadline has already passed"
            ).to.equal(false);
        });

        it("caps the remaining time budget into each attempt's timeout argument", async function () {
            clock = sinon.useFakeTimers();
            // budgetSeconds = 8 -> totalBudgetMs = 4000ms. Nothing here
            // consumes real/virtual time before the sync call, so the full
            // 4000ms budget is still available and, being under
            // RESUME_SYNC_TIMEOUT_MS (8000ms), is exactly what should be
            // passed as the attempt's timeoutMs.
            const { instance, syncAwaitableStub } = createManager(8);

            await instance.resumeFromBackground();

            expect(syncAwaitableStub.callCount).to.equal(1);
            const opts = syncAwaitableStub.getCall(0).args[2];
            expect(
                opts.timeoutMs,
                "deadline-budget: the remaining budget (4000ms) is under the per-attempt cap and must be passed through as-is"
            ).to.equal(4000);
        });

        it("caps each attempt's timeout at RESUME_SYNC_TIMEOUT_MS when the remaining budget exceeds it", async function () {
            clock = sinon.useFakeTimers();
            // budgetSeconds = 40 -> totalBudgetMs = 20000ms, well above the
            // 8000ms per-attempt cap.
            const { instance, syncAwaitableStub } = createManager(40);

            await instance.resumeFromBackground();

            expect(syncAwaitableStub.callCount).to.equal(1);
            const opts = syncAwaitableStub.getCall(0).args[2];
            expect(
                opts.timeoutMs,
                "deadline-budget: a large remaining budget must still be capped at RESUME_SYNC_TIMEOUT_MS (8000ms)"
            ).to.equal(8000);
        });

        it("exhausts a multi-peer candidate set and returns the LAST attempt's actual failure reason, not a collapsed generic value", async function () {
            clock = sinon.useFakeTimers();
            const { instance, getConnectedPeersStub, syncAwaitableStub } =
                createManager(40);
            getConnectedPeersStub.returns(
                new Set(["0xPeer1", "0xPeer2", "0xPeer3"])
            );
            syncAwaitableStub.onCall(0).resolves(failOutcome("request-failed"));
            syncAwaitableStub.onCall(1).resolves(failOutcome("rtt-exceeded"));
            syncAwaitableStub
                .onCall(2)
                .resolves(failOutcome("chain-view-mismatch"));

            const resultPromise = instance.resumeFromBackground();
            // Two RESUME_PEER_SWITCH_DELAY_MS (500ms) sleeps separate the
            // three attempts; advance the fake clock past both.
            await clock.tickAsync(1200);
            const result = await resultPromise;

            expect(
                syncAwaitableStub.callCount,
                "peer-rotation: all three distinct peers must have been tried"
            ).to.equal(3);
            expect(
                result,
                "peer-rotation: the returned failure reason must be the LAST attempted peer's actual reason"
            ).to.deep.equal({
                status: "failed",
                reason: "chain-view-mismatch",
                retryable: true
            } satisfies ResumeResult);
        });
    });

    it("resolves a failed, retryable result (with in-flight state cleared) when the sync call throws instead of returning a normal outcome", async function () {
        const { instance, syncAwaitableStub } = createManager();
        syncAwaitableStub.rejects(new Error("sync exploded"));

        const result = await instance.resumeFromBackground();

        expect(
            result.status,
            "failure-reason-fidelity: a thrown sync call must still resolve to a failed result, never hang or reject"
        ).to.equal("failed");
        expect(
            (result as any).retryable,
            "failure-reason-fidelity: a thrown sync call's failure must be retryable"
        ).to.equal(true);
        expect(
            (instance as any).resumeInFlight,
            "dedup state must be cleared even when the sync call throws"
        ).to.equal(undefined);
    });

    it("hydrate runs strictly before the transport rejoin on the successful path (ordering + resume-window enter precedes transport)", async function () {
        const { instance, hydrateStub, transportStub, enterResumeWindowStub } =
            createManager();

        const order: string[] = [];
        enterResumeWindowStub.callsFake(() => order.push("enterResumeWindow"));
        hydrateStub.callsFake(async () => {
            order.push("hydrate");
        });
        transportStub.callsFake(async () => {
            order.push("transport");
        });

        await instance.resumeFromBackground();

        const hydrateIndex = order.indexOf("hydrate");
        const transportIndex = order.indexOf("transport");
        const enterIndex = order.indexOf("enterResumeWindow");

        expect(
            hydrateIndex,
            "hydrate-ordering: hydrate must have run"
        ).to.be.greaterThan(-1);
        expect(
            transportIndex,
            "hydrate-ordering: transport rejoin must have run"
        ).to.be.greaterThan(-1);
        expect(
            hydrateIndex,
            "hydrate-ordering: hydrate must run strictly BEFORE the transport rejoin"
        ).to.be.lessThan(transportIndex);

        expect(
            enterIndex,
            "resume-window: enterResumeWindow must have run"
        ).to.be.greaterThan(-1);
        expect(
            enterIndex,
            "resume-window: enterResumeWindow must precede the transport rejoin"
        ).to.be.lessThan(transportIndex);
    });

    describe("resume-window exitResumeWindow is called exactly once on every exit path", function () {
        it("on a successful resume", async function () {
            const { instance, exitResumeWindowStub } = createManager();
            await instance.resumeFromBackground();
            expect(exitResumeWindowStub.callCount).to.equal(1);
        });

        it("on a transport failure", async function () {
            const { instance, transportStub, exitResumeWindowStub } =
                createManager();
            transportStub.rejects(new Error("boom"));
            await instance.resumeFromBackground();
            expect(exitResumeWindowStub.callCount).to.equal(1);
        });

        it("on a hydration failure", async function () {
            const { instance, hydrateStub, exitResumeWindowStub } =
                createManager();
            hydrateStub.rejects(new Error("boom"));
            await instance.resumeFromBackground();
            expect(exitResumeWindowStub.callCount).to.equal(1);
        });

        it("on a no-peers failure", async function () {
            const { instance, getConnectedPeersStub, exitResumeWindowStub } =
                createManager();
            getConnectedPeersStub.returns(new Set());
            await instance.resumeFromBackground();
            expect(exitResumeWindowStub.callCount).to.equal(1);
        });

        it("on a thrown exception from the sync call", async function () {
            const { instance, syncAwaitableStub, exitResumeWindowStub } =
                createManager();
            syncAwaitableStub.rejects(new Error("boom"));
            await instance.resumeFromBackground();
            expect(exitResumeWindowStub.callCount).to.equal(1);
        });

        it("on the dispose interlock", async function () {
            const { instance, hydrateStub, exitResumeWindowStub } =
                createManager();
            let resolveHydrate!: () => void;
            hydrateStub.returns(
                new Promise<void>((resolve) => {
                    resolveHydrate = resolve;
                })
            );

            const resultPromise = instance.resumeFromBackground();
            const disposePromise = instance.dispose();
            resolveHydrate();
            await resultPromise;
            await disposePromise;

            expect(exitResumeWindowStub.callCount).to.equal(1);
        });
    });

    it("every call into the stubbed sync method requests latest state (no forkId, no blockHeight)", async function () {
        const { instance, getConnectedPeersStub, syncAwaitableStub } =
            createManager(40);
        getConnectedPeersStub.returns(new Set(["0xPeer1", "0xPeer2"]));
        syncAwaitableStub.onCall(0).resolves(failOutcome("request-failed"));
        syncAwaitableStub.onCall(1).resolves(okOutcome());

        // No fake timers needed here: only argument shape is under test.
        const clock = sinon.useFakeTimers();
        try {
            const resultPromise = instance.resumeFromBackground();
            await clock.tickAsync(600);
            await resultPromise;
        } finally {
            clock.restore();
        }

        expect(syncAwaitableStub.callCount).to.equal(2);
        for (const call of syncAwaitableStub.getCalls()) {
            expect(
                call.args.length,
                "latest-state-only: syncAwaitable must be called with exactly (peer, channelId, opts) - no forkId/blockHeight arguments"
            ).to.equal(3);
            expect(
                call.args[3],
                "latest-state-only: no forkId argument may be passed"
            ).to.equal(undefined);
            expect(
                call.args[4],
                "latest-state-only: no blockHeight argument may be passed"
            ).to.equal(undefined);
        }
    });

    describe("dispose interlock", function () {
        it("settles an in-flight resume to a failed result, fires no phase hooks after disposal, and never launches a sync attempt after disposal is observed", async function () {
            const {
                instance,
                hydrateStub,
                transportStub,
                syncAwaitableStub,
                onResumePhaseStub,
                holepunchDisposeStub
            } = createManager();

            let resolveHydrate!: () => void;
            hydrateStub.returns(
                new Promise<void>((resolve) => {
                    resolveHydrate = resolve;
                })
            );

            const resultPromise = instance.resumeFromBackground();
            expect(
                hydrateStub.callCount,
                "resume should have already entered hydrate synchronously"
            ).to.equal(1);

            const disposePromise = instance.dispose();
            resolveHydrate();

            const result = await resultPromise;

            expect(
                result,
                "dispose-interlock: an in-flight resume disposed mid-flight must settle to a failed result"
            ).to.deep.equal({
                status: "failed",
                reason: "transport",
                retryable: false
            } satisfies ResumeResult);
            expect(
                transportStub.called,
                "dispose-interlock: the transport rejoin must never be attempted once disposal is observed"
            ).to.equal(false);
            expect(
                syncAwaitableStub.called,
                "dispose-interlock: no sync attempt may be launched once disposal is observed"
            ).to.equal(false);
            expect(
                onResumePhaseStub.calledWith("resyncing"),
                "dispose-interlock: 'resyncing' must never fire after disposal is observed"
            ).to.equal(false);

            await disposePromise;
            expect(
                holepunchDisposeStub.called,
                "dispose() must still tear down the swarm after the in-flight resume unwinds"
            ).to.equal(true);
        });

        it("returns a failed result immediately, without touching any stubbed collaborator, for a resumeFromBackground() call made after dispose() has resolved", async function () {
            const {
                instance,
                hydrateStub,
                transportStub,
                syncAwaitableStub,
                enterResumeWindowStub
            } = createManager();

            await instance.dispose();

            hydrateStub.resetHistory();
            transportStub.resetHistory();
            syncAwaitableStub.resetHistory();
            enterResumeWindowStub.resetHistory();

            const result = await instance.resumeFromBackground();

            expect(
                result,
                "dispose-interlock: resumeFromBackground() after dispose() must fail immediately"
            ).to.deep.equal({
                status: "failed",
                reason: "transport",
                retryable: false
            } satisfies ResumeResult);
            expect(
                hydrateStub.called,
                "dispose-interlock: a post-dispose call must never touch hydrate"
            ).to.equal(false);
            expect(
                transportStub.called,
                "dispose-interlock: a post-dispose call must never touch the transport rejoin"
            ).to.equal(false);
            expect(
                syncAwaitableStub.called,
                "dispose-interlock: a post-dispose call must never touch sync"
            ).to.equal(false);
            expect(
                enterResumeWindowStub.called,
                "dispose-interlock: a post-dispose call must never enter the resume window"
            ).to.equal(false);
        });
    });
});
