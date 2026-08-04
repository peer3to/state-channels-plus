import { expect } from "chai";
import { MathTestSession as TestSession } from "@test/harness";

describe("ReductionManager", function () {
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
                    const contract = sm.stateChannelManagerContract;
                    const original =
                        contract.isKillPeriodExpired.bind(contract);
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

                    contract.isKillPeriodExpired = (async (...parameters) => {
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
                            return await original(...parameters);
                        } finally {
                            activeCalls -= 1;
                        }
                    }) as typeof contract.isKillPeriodExpired;

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
                        contract.isKillPeriodExpired = original;
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
});
