// @spec-test-coverage-ignore: shared live fork-switch staging for mapped reduction tests
import { expect } from "chai";
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import { waitFor } from "@test/utils/waitFor";
import type { ForkId } from "@/types/types";

export async function assertLiveForkSwitch(
    h: MathPeerTestHarness,
    at: "disputes" | "compute" | "admission",
    resumeWith?: "undefined",
    postOnChain = false
): Promise<void> {
    const { sourceForkId } = await h.scenario.stageReducibleDisputedFork();
    const target = h.getPeer(0);
    const targetHold = await h.rpcStub.holdReductionAttempt(0, at, resumeWith);
    let responderHold: { release(): Promise<void> } | undefined;
    let secondCaller: Promise<unknown> | undefined;
    try {
        await h.control(target).stub.startTryReduce(sourceForkId).request();
        await waitFor(async () => (await targetHold.entered()) === 1);
        if (postOnChain) {
            secondCaller = h.execOnHost(
                target,
                async (sm, args) =>
                    (await sm.reductionManager.tryReduce(args.forkId)) ?? null,
                { forkId: sourceForkId }
            );
            await waitFor(
                async () =>
                    (await h
                        .control(target)
                        .stub.getReductionAttemptsInFlight()
                        .request()) === 2
            );
        }
        if (postOnChain) {
            await h
                .control(target)
                .stub.stubRecordForkLeave(sourceForkId)
                .request();
            await h.execOnHost(
                target,
                (sm, args) => {
                    sm.reductionManager.schedule(
                        args.forkId,
                        Math.floor(Date.now() / 1000) + args.delaySeconds
                    );
                },
                {
                    forkId: sourceForkId,
                    delaySeconds: h.event.protocolEventTimeoutMs() / 1000
                }
            );
        }
        const synced = await syncTargetToUnpostedReduction(
            h,
            0,
            2,
            sourceForkId
        );
        responderHold = synced.responderHold;
        if (secondCaller) expect(await secondCaller).to.equal(null);
        if (postOnChain) {
            const observation = await h
                .control(target)
                .stub.getForkLeaveObservation()
                .request();
            expect(observation.scheduled).to.equal(1);
            expect(observation.cancelled).to.equal(1);
            expect(observation.settledStateObserved).to.be.greaterThan(0);
            await h.control(target).stub.restoreForkLeave().request();
        }
        const before = await h.execOnHost(target, async (sm) => ({
            outboundCount: sm.storage.outboundMessages["blockMap"].size,
            disposed: sm.isDisposed
        }));
        const head = await h.control(target).query.getOutboundHead().request();
        const scheduled = await h
            .control(target)
            .stub.getHeldScheduledTaskCount("reduction-")
            .request();
        if (at !== "admission") {
            expect(
                (await h.control(target).stub.getTryReduceOutcome().request())
                    ?.settled === true
            ).to.equal(true);
        }
        await targetHold.release();
        await waitFor(
            async () =>
                (await h
                    .control(target)
                    .stub.getReductionAttemptsInFlight()
                    .request()) === 0
        );
        await waitFor(
            async () =>
                (await h.control(target).stub.getTryReduceOutcome().request())
                    ?.settled === true
        );
        expect(
            await h.control(target).stub.getTryReduceOutcome().request()
        ).to.deep.equal({
            settled: true,
            result: null,
            rejected: null
        });
        expect(
            await h.execOnHost(target, async (sm) => ({
                outboundCount: sm.storage.outboundMessages["blockMap"].size,
                disposed: sm.isDisposed
            }))
        ).to.deep.equal(before);
        expect(before.disposed).to.equal(false);
        expect(
            await h.execOnHost(
                target,
                (sm, args) => sm.reductionManager.hasOperation(args.forkId),
                { forkId: sourceForkId }
            )
        ).to.equal(false);
        expect(
            await h.control(target).query.getOutboundHead().request()
        ).to.deep.equal(head);
        expect(
            await h
                .control(target)
                .stub.getHeldScheduledTaskCount("reduction-")
                .request()
        ).to.equal(scheduled);
        expect(
            (await h.channelManager.getStateSnapshot(h.channelId)).forkId
        ).to.equal(sourceForkId);
        const responderResult = await h.execOnHost(
            h.getPeer(2),
            async (sm, args) => {
                sm.reductionManager.settleForkLeft(args.forkId);
                return (await sm.reductionManager.tryReduce(args.forkId))
                    ?.reducedForkId;
            },
            { forkId: sourceForkId }
        );
        expect(responderResult).to.equal(synced.reducedForkId);
        if (postOnChain) {
            await responderHold.release();
            await waitFor(
                async () =>
                    (await h.channelManager.getStateSnapshot(h.channelId))
                        .forkId === synced.reducedForkId
            );
            const handled = await h.execOnHost(
                target,
                async (sm, args) => {
                    const logs = (
                        await sm.stateChannelManagerContract.queryFilter(
                            sm.stateChannelManagerContract.filters.DisputeReducedResultCommitted(
                                sm.channelId
                            )
                        )
                    ).filter((log) => log.args.forkId === args.forkId);
                    if (!logs.length)
                        throw new Error("Missing reduced-result event");
                    for (const log of logs)
                        await sm.eventSyncService.scheduleLog(log);
                    const genesis =
                        sm.storage.stateSnapshots.getGenesisSnapshotByForkId(
                            sm.forkId
                        )!;
                    const encodedState =
                        sm.storage.stateMachineStates.getStateMachineState(
                            genesis.stateMachineStateHash
                        )!;
                    const installed =
                        await sm.reductionManager.completeWithGenesis(
                            args.forkId,
                            sm.forkId,
                            {
                                snapshotData: genesis.toStruct().snapshotData,
                                encodedState,
                                genesisTimestamp: Number(
                                    genesis.toStruct().timestamp
                                )
                            }
                        );
                    return {
                        installed,
                        hasOperation: sm.reductionManager.hasOperation(
                            args.forkId
                        ),
                        oldResult:
                            (await sm.reductionManager.tryReduce(
                                args.forkId
                            )) ?? null,
                        eventBlock: logs.at(-1)!.blockNumber
                    };
                },
                { forkId: sourceForkId }
            );
            expect(handled.hasOperation).to.equal(false);
            expect(handled.installed).to.equal(false);
            expect(handled.oldResult).to.equal(null);
            // The watermark also waits for other logs in this and earlier blocks.
            await waitFor(
                async () =>
                    (await h.execOnHost(target, (sm) =>
                        sm.storage.eventSync.getLatestProcessedBlock(
                            sm.channelId
                        )
                    ))! >= handled.eventBlock,
                h.event.protocolEventTimeoutMs()
            );
        }
    } finally {
        await h.control(target).stub.restoreForkLeave().request();
        await targetHold.release();
        await responderHold?.release();
    }
}

export async function assertRefusalAfterLiveForkSwitch(
    h: MathPeerTestHarness
): Promise<void> {
    const { sourceForkId } = await h.scenario.stageReducibleDisputedFork({
        disputingPeerIndices: [2, 3],
        beforeDispute: async () => {
            await h
                .control(h.getPeer(0))
                .stub.stubSuppressDisputeInitiation()
                .request();
        }
    });
    const target = h.getPeer(0);
    const responder = h.getPeer(2);
    await h.control(target).stub.restoreDisputeInitiation().request();
    const recording = await h.rpcStub.recordDisputeSubmissions(0, {
        hold: true,
        failWith: {
            customError: "RaceConditionDisputeWindowNotOpen",
            at: "send"
        }
    });
    let reduced: { release(): Promise<void> } | undefined;
    const attempt = h.execOnHost(
        target,
        async (sm, args) => {
            const recover = sm.eventSyncService.recoverOnChainSlashes.bind(
                sm.eventSyncService
            );
            let recoveries = 0;
            sm.eventSyncService.recoverOnChainSlashes = async (
                ...parameters
            ) => {
                recoveries += 1;
                return recover(...parameters);
            };
            try {
                await sm.disputeManager.dispute(args.forkId);
            } finally {
                sm.eventSyncService.recoverOnChainSlashes = recover;
            }
            return {
                recoveries,
                marker: sm.storage.disputes.didIDispute(args.forkId),
                disposed: sm.isDisposed
            };
        },
        { forkId: sourceForkId }
    );
    try {
        await recording.waitUntilHeld();
        const synced = await syncTargetToUnpostedReduction(
            h,
            0,
            2,
            sourceForkId
        );
        reduced = synced.responderHold;
        const forkId = synced.reducedForkId;
        await recording.release();
        expect(await attempt).to.deep.equal({
            recoveries: 0,
            marker: false,
            disposed: false
        });
        expect(await recording.submissions()).to.have.length(1);
        expect(await h.control(target).query.getForkId().request()).to.equal(
            forkId
        );
        expect(
            await h
                .control(target)
                .query.isBlacklisted(responder.address)
                .request()
        ).to.equal(false);
    } finally {
        await recording.release();
        await recording.restore();
        await reduced?.release();
    }
}

export async function syncTargetToUnpostedReduction(
    h: MathPeerTestHarness,
    targetIndex: number,
    responderIndex: number,
    sourceForkId: ForkId
) {
    const target = h.getPeer(targetIndex);
    const responder = h.getPeer(responderIndex);
    const responderHold = await h.rpcStub.holdReductionAttempt(
        responderIndex,
        "submit"
    );
    try {
        await h.control(responder).stub.startTryReduce(sourceForkId).request();
        await waitFor(async () => (await responderHold.entered()) === 1);
        const reducedForkId = await h
            .control(responder)
            .query.getForkId()
            .request();
        expect(reducedForkId).to.not.equal(sourceForkId);
        expect(
            (await h.channelManager.getStateSnapshot(h.channelId)).forkId
        ).to.equal(sourceForkId);
        expect(
            await h.execOnHost(
                target,
                async (sm, args) =>
                    sm.p2pManager.localRpc.spectateService.sync(
                        args.address,
                        sm.channelId,
                        args.forkId
                    ),
                { address: responder.address, forkId: reducedForkId }
            )
        ).to.equal(true);
        expect(await h.control(target).query.getForkId().request()).to.equal(
            reducedForkId
        );
        expect(
            await h
                .control(target)
                .query.isBlacklisted(responder.address)
                .request()
        ).to.equal(false);
        return { reducedForkId, responderHold };
    } catch (error) {
        await responderHold.release();
        throw error;
    }
}
