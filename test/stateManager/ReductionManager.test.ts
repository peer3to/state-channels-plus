import { assertLiveForkSwitch } from "@test/fixtures/ReductionForkSwitchStaging";
import { expect } from "chai";
import { id } from "ethers";

import { Status } from "@/types";
import { sleep } from "@/utils";
import { MathTestSession as TestSession } from "@test/harness";
import {
    assertDisposalDuringGenesisApplication,
    assertReadFailureDuringGenesisApplication
} from "@test/fixtures/ReductionDisposalStaging";
import type { ReductionApplicationControl } from "@test/fixtures/customRpc/harnessControl/services/stub/StubService";
import { REDUCTION_ATTEMPT_STUB_FAILURE } from "@test/fixtures/customRpc/harnessControl/services/stub/StubService";
import { waitFor } from "@test/utils/waitFor";
import type { SubmittedFinalDispute } from "@test/harness/actions/DisputeOrchestrator";

describe("ReductionManager", function () {
    it("a live fork switch after a held dispute read reschedules no old-fork work", async function () {
        await assertLiveForkSwitch(
            TestSession.getHarness(),
            "disputes",
            "undefined"
        );
    });
    it("a live fork switch after an unavailable candidate reschedules no old-fork work", async function () {
        await assertLiveForkSwitch(
            TestSession.getHarness(),
            "compute",
            "undefined"
        );
    });
    it("a live fork switch during candidate computation persists no old-fork work", async function () {
        await assertLiveForkSwitch(TestSession.getHarness(), "compute");
    });

    it("a live sync during the admission read does not recreate the old operation", async function () {
        await assertLiveForkSwitch(TestSession.getHarness(), "admission");
    });
    it("a reduced-result chain event after live sync finishes without an obsolete operation", async function () {
        await assertLiveForkSwitch(
            TestSession.getHarness(),
            "disputes",
            undefined,
            true
        );
    });

    it("returns undefined without retaining an operation for a non-disputed fork", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(4, 0);
        const result = await h.execOnHost(
            h.getPeer(0),
            async (sm, args) => {
                const reduction = await sm.reductionManager.tryReduce(
                    args.forkId
                );
                return {
                    reducedForkId: reduction?.reducedForkId ?? null,
                    hasOperation: sm.reductionManager.hasOperation(args.forkId)
                };
            },
            { forkId: h.activeForkId! }
        );

        expect(result.reducedForkId).to.equal(null);
        expect(result.hasOperation).to.equal(false);
    });

    it("keeps future timer state independent from reduction completion", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(4, 0);
        const hasOperation = await h
            .control(h.getPeer(0))
            .dispute.probeReductionScheduleIsolation(
                h.activeForkId!,
                Math.floor(Date.now() / 1000) + 60
            )
            .request();

        expect(hasOperation).to.equal(false);
    });

    it("reuses one resolved outcome for duplicate terminal triggers", async function () {
        const h = TestSession.getHarness();
        await h.scenario.preDisputeSetup({
            peerCount: 4,
            timeConfig: { evidenceTime: 3 }
        });
        const staged = await h.dispute.submitFinalDispute({
            maliciousPeerIndex: 1
        });
        await h.dispute.resolveFinalDispute(staged);
        const targetPeer = h.getPeer(0);
        const transitionCount = h.event.getEventCallCount(
            targetPeer.index,
            "onSetState"
        );
        const result = await h.execOnHost(
            targetPeer,
            async (sm, args) => {
                const first = sm.reductionManager.tryReduce(args.forkId);
                const second = sm.reductionManager.tryReduce(args.forkId);
                const [firstResult, secondResult] = await Promise.all([
                    first,
                    second
                ]);
                return {
                    firstReducedForkId: firstResult?.reducedForkId ?? null,
                    secondReducedForkId: secondResult?.reducedForkId ?? null
                };
            },
            {
                forkId: staged.forkId
            }
        );

        expect(result.firstReducedForkId).to.equal(
            staged.finalResolution.forkId
        );
        expect(result.secondReducedForkId).to.equal(
            staged.finalResolution.forkId
        );
        expect(
            h.event.getEventCallCount(targetPeer.index, "onSetState")
        ).to.equal(transitionCount);
    });

    it("checks the dispute status before starting reduction", async function () {
        const h = TestSession.getHarness();
        await h.scenario.preDisputeSetup({
            peerCount: 4,
            timeConfig: { evidenceTime: 8 }
        });
        const targetPeer = h.getPeer(0);
        await h.control(targetPeer).stub.stubHoldReductionTasks().request();
        const forkId = h.activeForkId!;
        await h.byzantine.submitInvalidStateTransitionBlock(1);
        await h.assert.dispute.initiatedAndCommitedWait({
            expectedCount: 1
        });

        try {
            const callCount = await h.execOnHost(
                targetPeer,
                async (sm, args) => {
                    const contract = sm.stateChannelManagerContract;
                    const original = contract.isForkDisputed.bind(contract);
                    let calls = 0;
                    contract.isForkDisputed = (async (...parameters) => {
                        calls += 1;
                        return original(...parameters);
                    }) as typeof contract.isForkDisputed;
                    try {
                        void sm.reductionManager
                            .tryReduce(args.forkId)
                            .catch(() => undefined);
                        await new Promise((resolve) => setTimeout(resolve, 50));
                        return calls;
                    } finally {
                        contract.isForkDisputed = original;
                    }
                },
                { forkId }
            );
            expect(callCount).to.equal(1);
        } finally {
            await h
                .control(targetPeer)
                .stub.restoreReductionTasks(false)
                .request();
        }
    });

    it("serializes concurrent ordinary reduction attempts", async function () {
        const h = TestSession.getHarness();
        await h.scenario.preDisputeSetup({
            peerCount: 4,
            timeConfig: { evidenceTime: 8 }
        });
        const targetPeer = h.getPeer(0);
        await h.control(targetPeer).stub.stubHoldReductionTasks().request();
        const forkId = h.activeForkId!;
        await h.byzantine.submitInvalidStateTransitionBlock(1);
        await h.assert.dispute.initiatedAndCommitedWait({
            expectedCount: 1
        });

        try {
            const result = await h.execOnHost(
                targetPeer,
                async (sm, args) => {
                    const executor = sm.reductionManager[
                        "reductionExecutor"
                    ] as unknown as {
                        tryReduceLocked(forkId: string): Promise<void>;
                    };
                    const original = executor.tryReduceLocked.bind(executor);
                    let activeCalls = 0;
                    let maximumActiveCalls = 0;
                    let totalCalls = 0;
                    let releaseFirst!: () => void;
                    const firstRelease = new Promise<void>((resolve) => {
                        releaseFirst = resolve;
                    });
                    let markFirstEntered!: () => void;
                    const firstEntered = new Promise<void>((resolve) => {
                        markFirstEntered = resolve;
                    });

                    executor.tryReduceLocked = async (attemptForkId) => {
                        totalCalls += 1;
                        activeCalls += 1;
                        maximumActiveCalls = Math.max(
                            maximumActiveCalls,
                            activeCalls
                        );
                        if (totalCalls === 1) {
                            markFirstEntered();
                            await firstRelease;
                        }
                        try {
                            return await original(attemptForkId);
                        } finally {
                            activeCalls -= 1;
                        }
                    };

                    try {
                        void sm.reductionManager
                            .tryReduce(args.forkId)
                            .catch(() => undefined);
                        await firstEntered;
                        void sm.reductionManager
                            .tryReduce(args.forkId)
                            .catch(() => undefined);
                        await new Promise((resolve) => setTimeout(resolve, 50));
                        const callsBeforeRelease = totalCalls;
                        releaseFirst();
                        await new Promise((resolve) =>
                            setTimeout(resolve, 100)
                        );
                        return {
                            callsBeforeRelease,
                            maximumActiveCalls
                        };
                    } finally {
                        releaseFirst();
                        executor.tryReduceLocked = original;
                    }
                },
                { forkId }
            );

            expect(result.callsBeforeRelease).to.equal(1);
            expect(result.maximumActiveCalls).to.equal(1);
        } finally {
            await h
                .control(targetPeer)
                .stub.restoreReductionTasks(false)
                .request();
        }
    });

    describe("terminal disposal", function () {
        it("disposal after the completion exists settles the attempt as undefined and installs nothing", async function () {
            const h = TestSession.getHarness();
            const { sourceForkId } =
                await h.scenario.stageReducibleDisputedFork({
                    peerCount: 4,
                    maliciousPeerIndex: 1
                });
            const target = h.getPeer(0);
            const setStateCalls = h.event.getEventCallCount(0, "onSetState");
            const hold = await h.rpcStub.holdReductionAttempt(0, "attempt");
            await h.control(target).stub.startTryReduce(sourceForkId).request();
            await waitFor(
                async () => (await hold.entered()) === 1,
                h.event.protocolEventTimeoutMs()
            );
            await h.control(target).stub.abortDetached().request();
            await waitFor(
                async () =>
                    await h.execOnHost(target, async (sm) =>
                        Boolean(sm.isDisposed)
                    )
            );
            // Disposal settles the caller while the executor is still held.
            await waitFor(
                async () =>
                    (
                        await h
                            .control(target)
                            .stub.getTryReduceOutcome()
                            .request()
                    )?.settled === true
            );
            await hold.release();

            const outcome = await h
                .control(target)
                .stub.getTryReduceOutcome()
                .request();
            expect(outcome).to.deep.equal({
                settled: true,
                result: null,
                rejected: null
            });
            expect(
                await h
                    .control(target)
                    .query.getCompletedReductionForkId(sourceForkId)
                    .request()
            ).to.equal(null);
            expect(
                await h.control(target).query.getForkId().request()
            ).to.equal(sourceForkId);
            expect(
                await h.control(target).query.getStatus().request()
            ).to.equal(Status.OPENED);
            expect(h.event.getEventCallCount(0, "onSetState")).to.equal(
                setStateCalls
            );
        });

        it("disposal during candidate computation persists no outbound block and installs nothing", async function () {
            const h = TestSession.getHarness();
            const { sourceForkId } =
                await h.scenario.stageReducibleDisputedFork({
                    peerCount: 4,
                    maliciousPeerIndex: 1
                });
            const target = h.getPeer(0);
            const outboundHead = await h
                .control(target)
                .query.getOutboundHead()
                .request();
            const outboundCount = await h.execOnHost(
                target,
                async (sm) => sm.storage.outboundMessages["blockMap"].size
            );
            const hold = await h.rpcStub.holdReductionAttempt(0, "compute");
            await h.control(target).stub.startTryReduce(sourceForkId).request();
            await waitFor(
                async () => (await hold.entered()) === 1,
                h.event.protocolEventTimeoutMs()
            );
            await h.control(target).stub.abortDetached().request();
            await waitFor(
                async () =>
                    await h.execOnHost(target, async (sm) =>
                        Boolean(sm.isDisposed)
                    )
            );
            // Disposal settles the caller while the executor is still held.
            await waitFor(
                async () =>
                    (
                        await h
                            .control(target)
                            .stub.getTryReduceOutcome()
                            .request()
                    )?.settled === true
            );
            await hold.release();

            expect(
                await h.control(target).stub.getTryReduceOutcome().request()
            ).to.deep.equal({ settled: true, result: null, rejected: null });
            expect(
                await h.execOnHost(
                    target,
                    async (sm) => sm.storage.outboundMessages["blockMap"].size
                )
            ).to.equal(outboundCount);
            expect(
                await h.control(target).query.getOutboundHead().request()
            ).to.deep.equal(outboundHead);
            expect(
                await h.control(target).query.getForkId().request()
            ).to.equal(sourceForkId);
            expect(
                await h
                    .control(target)
                    .query.getCompletedReductionForkId(sourceForkId)
                    .request()
            ).to.equal(null);
        });

        it("disposal while a direct completion waits for the state mutex installs nothing", async function () {
            const h = TestSession.getHarness();
            const { sourceForkId } =
                await h.scenario.stageReducibleDisputedFork({
                    peerCount: 4,
                    maliciousPeerIndex: 1
                });
            const target = h.getPeer(0);
            const reducedForkId = id("stub-reduced-fork");
            const mutex = await h.rpcStub.holdStateMutex(0);
            await waitFor(
                async () => (await mutex.entered()) === 1,
                h.event.protocolEventTimeoutMs()
            );
            await h
                .control(target)
                .stub.startCompleteWithGenesis(reducedForkId)
                .request();
            await h.control(target).stub.abortDetached().request();
            await waitFor(
                async () =>
                    await h.execOnHost(target, async (sm) =>
                        Boolean(sm.isDisposed)
                    ),
                h.event.protocolEventTimeoutMs()
            );
            await mutex.release();
            await waitFor(
                async () =>
                    (
                        await h
                            .control(target)
                            .stub.getCompleteWithGenesisOutcome()
                            .request()
                    )?.settled === true,
                h.event.protocolEventTimeoutMs()
            );

            expect(
                await h
                    .control(target)
                    .stub.getCompleteWithGenesisOutcome()
                    .request()
            ).to.deep.equal({ settled: true, result: "false", rejected: null });
            expect(
                await h.control(target).query.getForkId().request()
            ).to.equal(sourceForkId);
            expect(
                await h
                    .control(target)
                    .query.getCompletedReductionForkId(sourceForkId)
                    .request()
            ).to.equal(null);
        });

        it("disposal held at setState during genesis application commits nothing", async function () {
            await assertDisposalDuringGenesisApplication(
                TestSession.getHarness(),
                "setState"
            );
        });

        it("disposal held at getParticipants during genesis application commits nothing", async function () {
            await assertDisposalDuringGenesisApplication(
                TestSession.getHarness(),
                "getParticipants"
            );
        });

        it("disposal held at getNextToWrite during genesis application commits nothing", async function () {
            await assertDisposalDuringGenesisApplication(
                TestSession.getHarness(),
                "getNextToWrite"
            );
        });

        it("a getParticipants failure after the canonical setState aborts without committing", async function () {
            await assertReadFailureDuringGenesisApplication(
                TestSession.getHarness(),
                "getParticipants"
            );
        });

        it("a getNextToWrite failure after the canonical setState aborts without committing", async function () {
            await assertReadFailureDuringGenesisApplication(
                TestSession.getHarness(),
                "getNextToWrite"
            );
        });

        it("disposal after the local install and before the chain write submits nothing", async function () {
            const h = TestSession.getHarness();
            const { sourceForkId } =
                await h.scenario.stageReducibleDisputedFork({
                    peerCount: 4,
                    maliciousPeerIndex: 1
                });
            const target = h.getPeer(0);
            const hold = await h.rpcStub.holdReductionAttempt(0, "submit");
            try {
                await h
                    .control(target)
                    .stub.startTryReduce(sourceForkId)
                    .request();
                // The gas-limit read is reached only after the local install,
                // so the attempt has already settled with the reduced fork.
                await waitFor(async () => (await hold.entered()) === 1);
                expect(
                    (
                        await h
                            .control(target)
                            .stub.getTryReduceOutcome()
                            .request()
                    )?.result
                ).to.be.a("string");
                await h.control(target).stub.abortDetached().request();
                await waitFor(
                    async () =>
                        await h.execOnHost(target, async (sm) =>
                            Boolean(sm.isDisposed)
                        )
                );
            } finally {
                await hold.release();
            }
            // The released gas limit resolves into the disposal re-check, so
            // no chain write follows.
            await sleep(500);
            expect(
                await h
                    .control(target)
                    .stub.getReductionSubmitCallCount()
                    .request()
            ).to.equal(0);
        });

        it("an ordinary attempt that completes a window the chain already finalized converges without a chain write", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup({
                peerCount: 4,
                timeConfig: { evidenceTime: 3 }
            });
            const target = h.getPeer(0);
            // The final dispute is uploaded without its auditing data, so peer
            // 0 rebuilds it on commit; that rebuild is parked, and the
            // ordinary attempt (the window's kill period is pre-expired) is
            // the first to install the reduced fork, the deferral the commit
            // handler documents. The chain already records that fork from the
            // final dispute's upload: the attempt converges on it and writes
            // nothing, so the chain's snapshot stays where the dispute found
            // it until a snapshot post walks the fork.
            const rebuild = await h.rpcStub.holdAuditingDataRebuild(0);
            let staged: SubmittedFinalDispute;
            try {
                staged = await h.dispute.submitFinalDispute({
                    maliciousPeerIndex: 1,
                    withoutAuditingData: true
                });
                const timeoutMs = h.event.protocolEventTimeoutMs({
                    withFirstBlockGrace: true
                });
                await rebuild.waitUntilHeld(timeoutMs);
                await waitFor(
                    async () =>
                        (await h
                            .control(target)
                            .query.getForkId()
                            .request()) === staged.finalResolution.forkId,
                    timeoutMs
                );
            } finally {
                await rebuild.release();
                await h.dispute.restoreDisputeInitiation(
                    staged!.suppressedPeerIndices
                );
            }
            await sleep(1_000);
            expect(
                (await h.channelManager.getStateSnapshot(h.channelId)).forkId
            ).to.equal(staged!.forkId);
            expect(
                await h
                    .control(target)
                    .query.getCompletedReductionForkId(staged!.forkId)
                    .request()
            ).to.equal(staged!.finalResolution.forkId);
        });

        it("a fatal attempt error rejects the caller once with the original error and aborts", async function () {
            const h = TestSession.getHarness();
            const { sourceForkId } =
                await h.scenario.stageReducibleDisputedFork({
                    peerCount: 4,
                    maliciousPeerIndex: 1
                });
            const target = h.getPeer(0);
            const setStateCalls = h.event.getEventCallCount(0, "onSetState");
            const hold = await h.rpcStub.holdReductionAttempt(
                0,
                "compute",
                "throw"
            );
            await h.control(target).stub.startTryReduce(sourceForkId).request();
            await waitFor(async () => (await hold.entered()) === 1);
            await hold.release();
            await waitFor(
                async () =>
                    (
                        await h
                            .control(target)
                            .stub.getTryReduceOutcome()
                            .request()
                    )?.settled === true
            );

            expect(
                await h.control(target).stub.getTryReduceOutcome().request()
            ).to.deep.equal({
                settled: true,
                result: null,
                rejected: REDUCTION_ATTEMPT_STUB_FAILURE
            });
            await waitFor(
                async () =>
                    await h.execOnHost(target, async (sm) =>
                        Boolean(sm.isDisposed)
                    )
            );
            expect(
                await h.control(target).query.getForkId().request()
            ).to.equal(sourceForkId);
            expect(h.event.getEventCallCount(0, "onSetState")).to.equal(
                setStateCalls
            );
        });

        it("a stale dispute read after disposal reschedules nothing", async function () {
            const h = TestSession.getHarness();
            const { sourceForkId } =
                await h.scenario.stageReducibleDisputedFork({
                    peerCount: 4,
                    maliciousPeerIndex: 1
                });
            const target = h.getPeer(0);
            await h.control(target).stub.stubHoldReductionTasks().request();
            const hold = await h.rpcStub.holdReductionAttempt(
                0,
                "disputes",
                "undefined"
            );
            await h.control(target).stub.startTryReduce(sourceForkId).request();
            await waitFor(async () => (await hold.entered()) === 1);
            // Timers scheduled by live chain events before the abort are not
            // the subject; only the stale branch after it must add none.
            const heldBeforeAbort = await h
                .control(target)
                .stub.getHeldScheduledTaskCount("reduction-")
                .request();
            await h.control(target).stub.abortDetached().request();
            await waitFor(
                async () =>
                    await h.execOnHost(target, async (sm) =>
                        Boolean(sm.isDisposed)
                    )
            );
            await hold.release();
            await waitFor(
                async () =>
                    (
                        await h
                            .control(target)
                            .stub.getTryReduceOutcome()
                            .request()
                    )?.settled === true
            );
            expect(
                await h.control(target).stub.getTryReduceOutcome().request()
            ).to.deep.equal({ settled: true, result: null, rejected: null });
            expect(
                await h
                    .control(target)
                    .stub.getHeldScheduledTaskCount("reduction-")
                    .request()
            ).to.equal(heldBeforeAbort);
        });

        it("a stale candidate computation after disposal reschedules nothing", async function () {
            const h = TestSession.getHarness();
            const { sourceForkId } =
                await h.scenario.stageReducibleDisputedFork({
                    peerCount: 4,
                    maliciousPeerIndex: 1
                });
            const target = h.getPeer(0);
            await h.control(target).stub.stubHoldReductionTasks().request();
            const hold = await h.rpcStub.holdReductionAttempt(
                0,
                "compute",
                "undefined"
            );
            await h.control(target).stub.startTryReduce(sourceForkId).request();
            await waitFor(async () => (await hold.entered()) === 1);
            // Timers scheduled by live chain events before the abort are not
            // the subject; only the stale branch after it must add none.
            const heldBeforeAbort = await h
                .control(target)
                .stub.getHeldScheduledTaskCount("reduction-")
                .request();
            await h.control(target).stub.abortDetached().request();
            await waitFor(
                async () =>
                    await h.execOnHost(target, async (sm) =>
                        Boolean(sm.isDisposed)
                    )
            );
            await hold.release();
            await waitFor(
                async () =>
                    (
                        await h
                            .control(target)
                            .stub.getTryReduceOutcome()
                            .request()
                    )?.settled === true
            );
            expect(
                await h.control(target).stub.getTryReduceOutcome().request()
            ).to.deep.equal({ settled: true, result: null, rejected: null });
            expect(
                await h
                    .control(target)
                    .stub.getHeldScheduledTaskCount("reduction-")
                    .request()
            ).to.equal(heldBeforeAbort);
        });
    });

    describe("reduction application control boundary", function () {
        it("rejects a reject outcome at setState without installing a wrapper", async function () {
            await assertInvalidReductionControl(
                '{"outcome":"reject","at":"setState"}'
            );
        });

        it("rejects an unknown location without installing a wrapper", async function () {
            await assertInvalidReductionControl(
                '{"outcome":"hold","at":"applyGenesis"}'
            );
        });

        it("rejects an unknown outcome and extra keys without installing a wrapper", async function () {
            await assertInvalidReductionControl(
                '{"outcome":"explode","at":"setState","extra":true}'
            );
        });
    });
});

/** The payload is JSON as it would arrive over the control port. */
async function assertInvalidReductionControl(payload: string): Promise<void> {
    const h = TestSession.getHarness();
    await h.lifecycle.start(2, 0);
    const target = h.getPeer(0);
    const control: ReductionApplicationControl = JSON.parse(payload);
    let failure: unknown;
    try {
        await h
            .control(target)
            .stub.holdReductionGenesisApplication(control)
            .request();
    } catch (error) {
        failure = error;
    }
    expect((failure as Error).message).to.include(
        "Invalid reduction application control"
    );
    expect(
        await h
            .control(target)
            .stub.isReductionGenesisApplicationHeld()
            .request()
    ).to.equal(false);
    expect(
        await h
            .control(target)
            .stub.getHeldReductionGenesisApplicationCount()
            .request()
    ).to.equal(0);
}
