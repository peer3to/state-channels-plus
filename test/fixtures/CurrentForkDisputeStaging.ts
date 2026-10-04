// @spec-test-coverage-ignore: a real dispute event replayed on a peer whose fork changes across the handler's awaits, or after a real reduction or kill-period expiry
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import { Status } from "@/types";
import type { ForkId } from "@/types/types";
import { Codec, Type } from "@/utils";
import type { DisputeConfirmationStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { expect } from "chai";

/**
 * Peer 0 holds the fraud proof of an unkilled spam dispute. Its real
 * `onDisputeCommitted` handler runs that dispute's event again and parks once
 * the `hold` step answered, while the peer moves to the fork the dispute
 * names; the fork is restored afterwards. Asserts the steps that settled
 * (name, plus a boolean answer) and that no old-fork decision followed.
 */
export async function assertForkChangeStopsDecision(
    h: MathPeerTestHarness,
    hold: "expiryRead" | "audit" | "gasPreparation",
    expectedSteps: string[]
) {
    await h.scenario.stageUnkilledSpamDispute({
        killerIndex: 0,
        beforeDispute: async () => {
            for (const peer of h.peers)
                await h.control(peer).stub.stubHoldReductionTasks().request();
        }
    });
    const event = h.getPeer(0).eventSpies.onDisputeCommitted!.getCall(0).args;
    const { signedDispute } = event[1] as DisputeConfirmationStruct;
    const dispute = Codec.decode(signedDispute.encodedDispute, Type.Dispute);
    const applies = await h.rpcStub.recordDisputeFraudProofApplies(0);

    const handled = await h.execOnHost(
        h.getPeer(0),
        async (sm, a) => {
            const contract = sm.stateChannelManagerContract;
            const steps: string[] = [];
            let held = false;
            let [enter, release] = [() => {}, () => {}];
            const entered = new Promise<void>((resolve) => (enter = resolve));
            const gate = new Promise<void>((resolve) => (release = resolve));
            const restores: (() => void)[] = [];
            const wrap = (owner: object, key: string, holdAt?: string) => {
                const original = Reflect.get(owner, key) as (
                    ...x: unknown[]
                ) => Promise<unknown>;
                restores.push(() => Reflect.set(owner, key, original));
                Reflect.set(owner, key, async (...x: unknown[]) => {
                    const value: unknown = await original.apply(owner, x);
                    steps.push(
                        typeof value === "boolean" ? `${key} ${value}` : key
                    );
                    if (holdAt === a.hold && !held) {
                        held = true;
                        enter();
                        await gate;
                    }
                    return value;
                });
            };
            wrap(contract, "isKillPeriodExpired", "expiryRead");
            wrap(sm.disputeValidationService, "validateDispute", "audit");
            wrap(contract, "getStateTransitionReplayGas", "gasPreparation");
            wrap(sm.disputeManager, "killDispute");
            const forkId = sm.forkId;
            try {
                const handling = Reflect.apply(
                    sm.eventHandler.onDisputeCommitted,
                    sm.eventHandler,
                    a.event
                ) as Promise<void>;
                await Promise.race([entered, handling]);
                if (held) sm.forkId = a.successorForkId as ForkId;
                release();
                await handling;
            } finally {
                release();
                restores.forEach((restore) => restore());
                sm.forkId = forkId;
            }
            const live = await contract.isKillPeriodExpired(
                sm.channelId,
                forkId
            );
            const windowLive = live.windowExists && !live.isExpired;
            return { held, steps, windowLive };
        },
        { event, hold, successorForkId: dispute.outputSnapshotDataHash },
        { timeoutMs: h.event.hostExecTimeoutMs() }
    );

    expect(handled.held).to.equal(true);
    expect(handled.steps).to.deep.equal(expectedSteps);
    expect(handled.windowLive).to.equal(true);
    expect(await applies.applies()).to.deep.equal([]);
}

/**
 * Peer 0's real `onDisputeCommitted` handles the recorded dispute `event`
 * again. Records the steps that settled (name, plus a boolean answer; the
 * local-diamond write as "mirror") and every reduction schedule; returns them
 * with the peer's fork and status afterwards.
 */
async function replayDisputeEvent(h: MathPeerTestHarness, event: unknown[]) {
    return h.execOnHost(
        h.getPeer(0),
        async (sm, a) => {
            const steps: string[] = [];
            const scheduled: { forkId: string; triggerTimestamp: number }[] =
                [];
            const restores: (() => void)[] = [];
            const wrap = (owner: object, key: string, label = key) => {
                const original = Reflect.get(owner, key) as (
                    ...x: unknown[]
                ) => Promise<unknown>;
                restores.push(() => Reflect.set(owner, key, original));
                Reflect.set(owner, key, async (...x: unknown[]) => {
                    const value: unknown = await original.apply(owner, x);
                    steps.push(
                        typeof value === "boolean" ? `${label} ${value}` : label
                    );
                    return value;
                });
            };
            wrap(
                sm.diamondStateMachine.localDiamondContract,
                "onDisputeCommitted",
                "mirror"
            );
            wrap(sm.stateChannelManagerContract, "isKillPeriodExpired");
            wrap(sm.disputeValidationService, "validateDispute");
            wrap(sm.disputeManager, "killDispute");
            wrap(sm.disputeManager, "dispute");
            wrap(sm.reductionManager, "completeWithGenesis");
            const reduction = sm.reductionManager;
            const schedule = reduction.schedule;
            restores.push(() => (reduction.schedule = schedule));
            reduction.schedule = (forkId, triggerTimestamp, isRescheduled) => {
                steps.push("schedule");
                scheduled.push({ forkId: String(forkId), triggerTimestamp });
                schedule.call(
                    reduction,
                    forkId,
                    triggerTimestamp,
                    isRescheduled
                );
            };
            try {
                await (Reflect.apply(
                    sm.eventHandler.onDisputeCommitted,
                    sm.eventHandler,
                    a.event
                ) as Promise<void>);
            } finally {
                restores.forEach((restore) => restore());
            }
            return { steps, scheduled, forkId: sm.forkId, status: sm.status };
        },
        { event },
        { timeoutMs: h.event.hostExecTimeoutMs() }
    );
}

/**
 * After a real reduction moved peer 0 to the successor fork, the old fork's
 * non-final dispute event arrives again: only the mirror records it; no
 * expiry read, audit, kill, evidence or reduction schedule follows.
 */
export async function assertOldNonfinalEventStartsNoAdjudication(
    h: MathPeerTestHarness
) {
    const { sourceForkId } = await h.scenario.stageReducibleDisputedFork();
    const event = h.getPeer(0).eventSpies.onDisputeCommitted!.getCall(0).args;
    expect(event[3], "non-final event").to.equal(false);
    await h.control(h.getPeer(0)).stub.startTryReduce(sourceForkId).request();
    const { newForkId } = await h.dispute.resolveDisputeWait({
        forkId: sourceForkId
    });
    const applies = await h.rpcStub.recordDisputeFraudProofApplies(0);

    const handled = await replayDisputeEvent(h, event);

    expect(handled.steps).to.deep.equal(["mirror"]);
    expect(handled.forkId).to.equal(newForkId);
    expect(handled.status).to.equal(Status.PARTICIPATING);
    expect(await applies.applies()).to.deep.equal([]);
}

/**
 * The current fork's non-final dispute event arrives again after its kill
 * period expired (reductions held): the audit runs in full (it persists the
 * dispute data, nothing is killed) and the reduction is scheduled at the
 * kill period end.
 */
export async function assertSameForkExpiredEventSchedulesReduction(
    h: MathPeerTestHarness
) {
    const { sourceForkId } = await h.scenario.stageReducibleDisputedFork();
    const event = h.getPeer(0).eventSpies.onDisputeCommitted!.getCall(0).args;
    expect(event[3], "non-final event").to.equal(false);
    await h.assert.dispute.killPeriodExpiredWait(sourceForkId);
    const { killPeriodEnd } = await h.query.killPeriod(sourceForkId);

    const handled = await replayDisputeEvent(h, event);

    expect(handled.steps).to.deep.equal([
        "mirror",
        "isKillPeriodExpired",
        "validateDispute true",
        "schedule"
    ]);
    expect(handled.scheduled).to.deep.equal([
        { forkId: sourceForkId, triggerTimestamp: Number(killPeriodEnd) }
    ]);
    expect(handled.forkId).to.equal(sourceForkId);
}

/**
 * A threshold-final dispute reduced peer 0 to its successor; the old fork's
 * final event arrives again: it completes against the existing reduction
 * (no second install, no abort) and the operation keeps its result.
 */
export async function assertOldFinalEventCompletesReduction(
    h: MathPeerTestHarness
) {
    await h.scenario.preDisputeSetup({
        peerCount: 4,
        timeConfig: { evidenceTime: 3 }
    });
    const staged = await h.dispute.submitFinalDispute({
        maliciousPeerIndex: 1
    });
    await h.dispute.resolveFinalDispute(staged);
    const reducedForkId = staged.finalResolution.forkId;
    const event = h
        .getPeer(0)
        .eventSpies.onDisputeCommitted!.getCalls()
        .map((call) => call.args)
        .find((args) => args[3] === true);
    expect(event, "final event").to.not.equal(undefined);
    const installs = h.event.getEventCallCount(0, "onSetState");

    const handled = await replayDisputeEvent(h, event!);

    expect(handled.steps).to.deep.equal([
        "mirror",
        "completeWithGenesis false"
    ]);
    expect(handled.forkId).to.equal(reducedForkId);
    expect(handled.status).to.equal(Status.PARTICIPATING);
    expect(h.event.getEventCallCount(0, "onSetState")).to.equal(installs);
    const operation = await h.execOnHost(
        h.getPeer(0),
        async (sm, a) =>
            (await sm.reductionManager.tryReduce(a.forkId))?.reducedForkId ??
            null,
        { forkId: staged.forkId }
    );
    expect(operation).to.equal(reducedForkId);
}
