import { sleep } from "@/utils";
import { REDUCTION_ATTEMPT_STUB_FAILURE } from "@test/fixtures/customRpc/harnessControl/services/stub/StubService";
import { assertInvalidReductionControl } from "@test/fixtures/InvalidReductionControlFixture";
import {
    assertAbortedReductionSendsNothing,
    assertReadFailureDuringGenesisApplication,
    stageDisposalFork
} from "@test/fixtures/ReductionDisposalStaging";
import { assertDirectCompletionLosesForkInMutex } from "@test/fixtures/ReductionForkSwitchStaging";
import { assertLiveForkSwitch } from "@test/fixtures/ReductionForkSwitchStaging";
import { assertSyncedLeaverSkipsSubmission } from "@test/fixtures/SyncedLeaverReductionStaging";
import { MathTestSession as TestSession } from "@test/harness";
import type { SubmittedFinalDispute } from "@test/harness/actions/DisputeOrchestrator";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

describe("ReductionManager", function () {
    it("direct completion returns false and removes the operation when the fork changes inside its mutex wait", async function () {
        await assertDirectCompletionLosesForkInMutex(TestSession.getHarness());
    });
    it("a leaving signer that becomes SYNCED during installation skips reduction submission", async function () {
        await assertSyncedLeaverSkipsSubmission(TestSession.getHarness());
    });

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
        it("an abort while a reduction attempt is held sends no transaction once the attempt is released", async function () {
            await assertAbortedReductionSendsNothing(
                TestSession.getHarness(),
                "attempt"
            );
        });

        it("an abort while the reduction genesis application is held at setState sends no transaction once it is released", async function () {
            await assertAbortedReductionSendsNothing(
                TestSession.getHarness(),
                "setState"
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

        it("an ordinary attempt that completes a window the chain already finalized converges without a chain write", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup({
                peerCount: 4,
                timeConfig: { evidenceTime: 3 }
            });
            const { query } = h.control(h.getPeer(0));
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
                        (await query.getForkId().request()) ===
                        staged.finalResolution.forkId,
                    timeoutMs
                );
            } finally {
                await rebuild.release();
                await h.dispute.restoreDisputeInitiation(
                    staged!.suppressedPeerIndices
                );
            }
            // Observe that releasing the held rebuild causes no later chain snapshot write.
            await sleep(1_000);
            expect(
                (await h.channelManager.getStateSnapshot(h.channelId)).forkId
            ).to.equal(staged!.forkId);
            expect(
                await query
                    .getCompletedReductionForkId(staged!.forkId)
                    .request()
            ).to.equal(staged!.finalResolution.forkId);
        });

        it("a fatal attempt error rejects the caller once with the original error and aborts", async function () {
            const h = TestSession.getHarness();
            const { sourceForkId } = await stageDisposalFork(h);
            const target = h.getPeer(0);
            const { stub, query } = h.control(target);
            const setStateCalls = h.event.getEventCallCount(0, "onSetState");
            const hold = await h.rpcStub.holdReductionAttempt(
                0,
                "compute",
                "throw"
            );
            // keeps the control RPC reachable after the abort
            const releaseDisposal = await h.rpcStub.holdRuntimeDisposal(0);
            try {
                await stub.startTryReduce(sourceForkId).request();
                await waitFor(async () => (await hold.entered()) === 1);
                await hold.release();
                await waitFor(
                    async () =>
                        (await stub.getTryReduceOutcome().request())
                            ?.settled === true
                );

                expect(
                    await stub.getTryReduceOutcome().request()
                ).to.deep.equal({
                    settled: true,
                    result: null,
                    rejected: REDUCTION_ATTEMPT_STUB_FAILURE
                });
                await h.event.waitForPeers("onAbort", [0], 1);
                expect(await query.getForkId().request()).to.equal(
                    sourceForkId
                );
                expect(h.event.getEventCallCount(0, "onSetState")).to.equal(
                    setStateCalls
                );
            } finally {
                await releaseDisposal();
            }
            await target.p2pInstance.dispose();
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
