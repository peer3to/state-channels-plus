// @spec-test-coverage-ignore: pinned sync staging exercised by explicit component and E2E declarations
import StateSnapshot from "@/models/StateSnapshot";
import type { SyncPayload } from "@/types";
import type { ForkId } from "@/types/types";
import { Codec, hash, Type } from "@/utils";
import {
    stageAnchoredSyncPayload,
    withHeldFreshRequester
} from "@test/fixtures/HistoricSyncStaging";
import type { MathPeerTestHarness } from "@test/fixtures/MathPeerTestHarness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { id, ZeroHash } from "ethers";

/**
 * The source holds a computed successor whose genesis is not installed and
 * keeps its own fork behind it; the observer requests the source fork, the
 * successor, or the latest state (no fork) and syncs to the successor.
 */
export async function assertComputedSuccessorSync(
    h: MathPeerTestHarness,
    requested: "source" | "successor" | "latest"
): Promise<void> {
    const { sourceForkId } = await h.scenario.stageReducibleDisputedFork();
    const source = h.getPeer(0);
    const observer = h.getPeer(2);
    const hold = await h.rpcStub.holdReductionGenesisApplication(0, {
        outcome: "hold",
        at: "setState"
    });
    try {
        await h.control(source).stub.startTryReduce(sourceForkId).request();
        await waitFor(async () => (await hold.entered()) === 1);
        const successor = await h.execOnHost(
            source,
            async (sm, { forkId }) => {
                const disputes = await sm.agreementManager.getForkDisputes(
                    (await sm.eventSyncService.loadSynchronizedWindowCommitments(
                        sm.channelId,
                        forkId
                    ))!
                );
                return (await sm.reductionManager.computeReductionLocally(
                    forkId,
                    disputes
                ))!.reducedForkId;
            },
            { forkId: sourceForkId }
        );
        expect(
            await h.execOnHost(
                source,
                async (sm, { forkId }) =>
                    !!sm.storage.stateSnapshots.getGenesisSnapshotByForkId(
                        forkId
                    ),
                { forkId: successor }
            )
        ).to.equal(false);
        // the source's own fork is behind the latest fork it derives
        expect(await h.control(source).query.getForkId().request()).to.equal(
            sourceForkId
        );
        const accepted = await h.execOnHost(
            observer,
            async (sm, args) =>
                sm.p2pManager.localRpc.spectateService.sync(
                    args.source,
                    sm.channelId,
                    args.forkId ?? undefined
                ),
            {
                source: source.address,
                forkId:
                    requested === "successor"
                        ? successor
                        : requested === "source"
                          ? sourceForkId
                          : null
            }
        );
        expect(accepted).to.equal(true);
        expect(await h.control(observer).query.getForkId().request()).to.equal(
            successor
        );
        expect(
            await h
                .control(observer)
                .query.isBlacklisted(source.address)
                .request()
        ).to.equal(false);
        expect(
            await h
                .control(source)
                .query.isBlacklisted(observer.address)
                .request()
        ).to.equal(false);
    } finally {
        await hold.release();
    }
}

export async function assertPinnedHeight(
    h: MathPeerTestHarness,
    offset: number
): Promise<void> {
    await h.lifecycle.start(3, 0);
    await h.transition.advanceState({
        count: 3,
        waitForPeers: [0, 1, 2],
        waitForFinalization: true
    });
    const source = h.getPeer(0),
        requester = h.getPeer(2);
    const height = await h.execOnHost(
        source,
        async (sm) => sm.storage.blocks.getNextBlockHeight(sm.forkId) - 1
    );
    if (offset <= 0) {
        const provedHeight = await h.execOnHost(
            source,
            async (sm, { minimum }) => {
                const payload =
                    await sm.p2pManager.localRpc.spectateService.generateSyncPayload(
                        sm.channelId,
                        sm.forkId,
                        minimum
                    );
                if (!payload) throw new Error("Missing valid pinned proof");
                const [hasBlock, latest] =
                    await sm.diamondStateMachine.localDiamondContract.getLatestBlockFromStateProof(
                        payload.stateProof
                    );
                if (!hasBlock) throw new Error("Missing pinned proof block");
                return Number(latest.transaction.header.transactionCnt);
            },
            { minimum: height + offset }
        );
        expect(provedHeight).to.equal(height);
    }
    const accepted = await h.execOnHost(
        requester,
        async (sm, args) =>
            sm.p2pManager.localRpc.spectateService.sync(
                args.source,
                sm.channelId,
                sm.forkId,
                args.height
            ),
        { source: source.address, height: height + offset }
    );
    expect(accepted).to.equal(offset <= 0);
    // The refused request is one strike on the requester's side, not a
    // verdict; the responder still blacklists a requester it cannot serve.
    expect(
        await h.control(requester).query.isBlacklisted(source.address).request()
    ).to.equal(false);
    expect(
        await h.control(requester).query.getStrikes(source.address).request()
    ).to.equal(offset > 0 ? 1 : 0);
    expect(
        await h.control(source).query.isBlacklisted(requester.address).request()
    ).to.equal(offset > 0);
}

// A pinned request sets a minimum; an ahead responder serves its latest proof.
export async function expectSyncPayloadAboveRequestedHeightWhileAhead(
    h: MathPeerTestHarness,
    requestedHeight: number
) {
    await h.lifecycle.start(2, 0, {
        timeConfig: {
            p2pTime: 5,
            agreementTime: 10,
            chainFallbackTime: 2,
            evidenceTime: 10
        }
    });

    // Advance so the responder is finalized well beyond the target.
    await h.transition.advanceState({
        count: 3,
        waitForFinalization: true
    });

    const responder = h.getPeer(0);
    const forkId = h.activeForkId!;

    // The responder is locally ahead of the requested target.
    const responderLatest = await h
        .control(responder)
        .query.getLatestBlockBundle(forkId)
        .request();
    expect(responderLatest).to.not.equal(null);
    expect(responderLatest!.height).to.be.greaterThan(requestedHeight);

    const syncResult = await h
        .control(responder)
        .spectate.generateSyncPayload(h.channelId!, forkId, requestedHeight)
        .request();
    expect(syncResult).to.not.equal(null);
    const syncPayload = Codec.decode(
        syncResult!.encodedSyncPayload,
        Type.SyncPayload
    );

    const latestFinalizedSnapshot =
        syncPayload.milestoneSnapshots.at(-1) ??
        syncPayload.latestForkGenesisSnapshot;
    expect(Number(latestFinalizedSnapshot.blockHeight)).to.equal(
        responderLatest!.height,
        "sync payload must prove the responder's latest height"
    );
}

export async function assertSyncWindowReadRace(
    h: MathPeerTestHarness,
    landOnChain: boolean
): Promise<void> {
    const { sourceForkId } = await h.scenario.stageReducibleDisputedFork();
    const source = h.getPeer(0);
    const observer = h.getPeer(2);
    const events = await h.rpcStub.holdReductionRace(observer.index);
    await h.control(observer).stub.holdSyncWindowPersistence().request();
    const sync = h.execOnHost(
        observer,
        async (sm, args) =>
            sm.p2pManager.localRpc.spectateService.sync(
                args.source,
                sm.channelId,
                args.forkId
            ),
        { source: source.address, forkId: sourceForkId }
    );
    try {
        await waitFor(
            async () =>
                (await h
                    .control(observer)
                    .stub.getSyncWindowPersistenceEntered()
                    .request()) === 1
        );
        if (landOnChain) {
            await h.control(source).stub.restoreReductionTasks(true).request();
            await waitFor(async () =>
                h.execOnHost(
                    source,
                    async (sm, { forkId }) =>
                        sm.stateChannelManagerContract.isReduceChallengePeriodExpired(
                            sm.channelId,
                            forkId
                        ),
                    { forkId: sourceForkId }
                )
            );
            expect(
                await h.execOnHost(
                    observer,
                    async (sm, { forkId }) =>
                        (
                            await sm.diamondStateMachine.localDiamondContract.getDisputeWindows(
                                sm.channelId,
                                [forkId]
                            )
                        )[0].reducedResult.forkId,
                    { forkId: sourceForkId }
                )
            ).to.equal(ZeroHash);
        } else {
            // Finish a real competing verification after the outer call refreshes
            // its chain window, so the shared VM contains a local-only reduction.
            const innerAccepted = await h.execOnHost(
                observer,
                async (sm, args) => {
                    const request = {
                        channelId: sm.channelId,
                        forkId: args.forkId
                    };
                    const response =
                        await sm.p2pManager.remoteRpc.spectateService
                            .onSpectateRequest(request)
                            .request(args.source);
                    return sm.p2pManager.localRpc.spectateService.applySyncResponse(
                        args.source,
                        request,
                        response.encodedSyncPayload
                    );
                },
                { source: source.address, forkId: sourceForkId }
            );
            expect(innerAccepted).to.equal(true);
        }
        expect(
            await h.execOnHost(
                source,
                async (sm, { forkId }) =>
                    sm.stateChannelManagerContract.isReduceChallengePeriodExpired(
                        sm.channelId,
                        forkId
                    ),
                { forkId: sourceForkId }
            )
        ).to.equal(landOnChain);
        await h.control(observer).stub.releaseSyncWindowPersistence().request();
        expect(await sync).to.equal(true);
        expect(
            await h
                .control(observer)
                .query.isBlacklisted(source.address)
                .request()
        ).to.equal(false);
        expect(
            await h
                .control(source)
                .query.isBlacklisted(observer.address)
                .request()
        ).to.equal(false);
    } finally {
        await h.control(observer).stub.releaseSyncWindowPersistence().request();
        await sync;
        await events.release({ replayEvents: false, keepTasksHeld: true });
    }
}

export async function assertConcurrentSyncWindowOverwrite(
    h: MathPeerTestHarness
) {
    const { sourceForkId } = await h.scenario.stageReducibleDisputedFork();
    const observer = h.getPeer(2);
    const sources = [h.getPeer(0), h.getPeer(3)];
    const events = await h.rpcStub.holdReductionRace(observer.index);
    const stub = h.control(observer).stub;
    await stub.holdSyncReductionResult().request();
    const first = h.execOnHost(
        observer,
        async (sm, args) =>
            sm.p2pManager.localRpc.spectateService.sync(
                args.source,
                sm.channelId,
                args.forkId
            ),
        { source: sources[0].address, forkId: sourceForkId }
    );
    let second: Promise<boolean> | undefined;
    try {
        await waitFor(
            async () => (await stub.getSyncReductionEntered().request()) === 1
        );
        await stub.holdSyncWindowPersistence().request();
        second = h.execOnHost(
            observer,
            async (sm, args) =>
                sm.p2pManager.localRpc.spectateService.sync(
                    args.source,
                    sm.channelId,
                    args.forkId
                ),
            { source: sources[1].address, forkId: sourceForkId }
        );
        await waitFor(
            async () =>
                (await stub.getSyncWindowPersistenceEntered().request()) === 1
        );
        expect(
            await h.execOnHost(
                observer,
                async (sm, args) =>
                    (
                        await sm.diamondStateMachine.localDiamondContract.getDisputeWindows(
                            sm.channelId,
                            [args.forkId]
                        )
                    )[0].reducedResult.forkId,
                { forkId: sourceForkId }
            )
        ).to.equal(ZeroHash);
        await stub.releaseSyncReductionResult().request();
        expect(await first).to.equal(true);
        await stub.releaseSyncWindowPersistence().request();
        expect(await second).to.equal(true);
        for (const source of sources) {
            expect(
                await h
                    .control(observer)
                    .query.isBlacklisted(source.address)
                    .request()
            ).to.equal(false);
            expect(
                await h
                    .control(source)
                    .query.isBlacklisted(observer.address)
                    .request()
            ).to.equal(false);
        }
    } finally {
        await stub.releaseSyncReductionResult().request();
        await stub.releaseSyncWindowPersistence().request();
        await first;
        await second;
        await events.release({ replayEvents: false, keepTasksHeld: true });
    }
}

export async function assertBatchedSyncFinality(h: MathPeerTestHarness) {
    const { sourceForkId } = await h.scenario.stageReducibleDisputedFork();
    const observer = h.getPeer(2);
    const source = h.getPeer(0);
    const stub = h.control(observer).stub;
    await stub.recordSyncFinalityReads().request();
    await stub.recordSyncRejections().request();
    try {
        const response = await h.execOnHost(
            observer,
            async (sm, args) =>
                sm.p2pManager.remoteRpc.spectateService
                    .onSpectateRequest({
                        channelId: sm.channelId,
                        forkId: args.forkId
                    })
                    .request(args.source),
            { source: source.address, forkId: sourceForkId }
        );
        const payload = Codec.decode(
            response.encodedSyncPayload,
            Type.SyncPayload
        );
        // Repeat a real proved window to exercise responder-sized input before rejection;
        // the repeat does not continue from the first window's reduced fork.
        payload.disputeWindows.push(payload.disputeWindows[0]);
        const accepted = await h.execOnHost(
            observer,
            async (sm, args) =>
                sm.p2pManager.localRpc.spectateService.applySyncResponse(
                    args.source,
                    { channelId: sm.channelId, forkId: args.forkId },
                    args.encodedSyncPayload
                ),
            {
                source: source.address,
                forkId: sourceForkId,
                encodedSyncPayload: Codec.encode(
                    payload,
                    Type.SyncPayload
                ) as string
            }
        );
        expect(accepted).to.equal(false);
        expect(
            await stub.restoreRecordedSyncRejections().request()
        ).to.deep.equal(["dispute window not linked"]);
        expect(await stub.getSyncFinalityReadWidths().request()).to.deep.equal([
            2
        ]);
    } finally {
        await stub.restoreRecordedSyncRejections().request();
        await stub.restoreSyncFinalityReads().request();
    }
}

export async function assertConcurrentPinnedRequests(
    h: MathPeerTestHarness,
    mode: "same" | "lower" | "higher" | "failure"
): Promise<void> {
    await h.lifecycle.start(2, 2);
    const observer = h.getPeer(0);
    const source = h.getPeer(1);
    const block = await h
        .control(source)
        .query.getLatestBlockBundle(h.activeForkId!)
        .request();
    if (!block) throw new Error("Expected a proven block");
    const restoreCounter = await h.rpcStub.stubCountSpectateRequests(
        source.index
    );
    await h
        .control(source)
        .stub.holdSpectateResponses(mode === "failure")
        .request();
    const pending = h.execOnHost(
        observer,
        (sm, args) =>
            Promise.all([
                sm.p2pManager.localRpc.spectateService.sync(
                    args.source,
                    sm.channelId,
                    sm.forkId,
                    args.first
                ),
                sm.p2pManager.localRpc.spectateService.sync(
                    args.source,
                    sm.channelId,
                    sm.forkId,
                    args.second
                )
            ]),
        {
            source: source.address,
            first: mode === "higher" ? block.height - 1 : block.height,
            second: mode === "lower" ? block.height - 1 : block.height
        }
    );
    try {
        await waitFor(
            async () =>
                (await h
                    .control(source)
                    .stub.getHeldSpectateResponseCount()
                    .request()) === 1
        );
        expect(await h.rpcStub.getSpectateRequestCount(source.index)).to.equal(
            1
        );
        await h.control(source).stub.releaseSpectateResponses().request();
        expect(await pending).to.deep.equal(
            mode === "failure" ? [false, false] : [true, true]
        );
        expect(await h.rpcStub.getSpectateRequestCount(source.index)).to.equal(
            mode === "higher" ? 2 : 1
        );
        expect(
            await h
                .control(observer)
                .query.isBlacklisted(source.address)
                .request()
        ).to.equal(false);
        expect(
            await h.control(observer).query.getStrikes(source.address).request()
        ).to.equal(mode === "failure" ? 1 : 0);
    } finally {
        await h.control(source).stub.releaseSpectateResponses().request();
        await pending;
        await restoreCounter();
    }
}

/**
 * Peer 0's payload for a disputed source fork, altered by `mutate` and applied
 * by peer 2. The on-chain snapshot stays on the source fork. Returns the
 * verdict and the recorded rejection reasons.
 */
export async function applyDisputedSyncPayload(
    h: MathPeerTestHarness,
    mutate: (payload: SyncPayload, sourceForkId: ForkId) => void
): Promise<{ accepted: boolean; rejections: string[] }> {
    const { sourceForkId } = await h.scenario.stageReducibleDisputedFork();
    expect(
        StateSnapshot.from(await h.channelManager.getStateSnapshot(h.channelId))
            .forkID
    ).to.equal(sourceForkId);
    const observer = h.getPeer(2);
    const source = h.getPeer(0);
    const stub = h.control(observer).stub;
    await stub.recordSyncRejections().request();
    try {
        const response = await h.execOnHost(
            observer,
            async (sm, args) =>
                sm.p2pManager.remoteRpc.spectateService
                    .onSpectateRequest({
                        channelId: sm.channelId,
                        forkId: args.forkId
                    })
                    .request(args.source),
            { source: source.address, forkId: sourceForkId }
        );
        const payload = Codec.decode(
            response.encodedSyncPayload,
            Type.SyncPayload
        );
        expect(payload.disputeWindows.length).to.equal(1);
        expect(payload.disputeWindows[0].forkId).to.equal(sourceForkId);
        mutate(payload, sourceForkId);
        const accepted = await h.execOnHost(
            observer,
            async (sm, args) =>
                sm.p2pManager.localRpc.spectateService.applySyncResponse(
                    args.source,
                    { channelId: sm.channelId, forkId: args.forkId },
                    args.encodedSyncPayload
                ),
            {
                source: source.address,
                forkId: sourceForkId,
                encodedSyncPayload: Codec.encode(
                    payload,
                    Type.SyncPayload
                ) as string
            }
        );
        return {
            accepted,
            rejections: await stub.restoreRecordedSyncRejections().request()
        };
    } finally {
        await stub.restoreRecordedSyncRejections().request();
    }
}

/**
 * Peer 0 serves a payload for the disputed source fork while the chain is
 * still on it; the reduction and its fork adoption then land, and peer 2
 * applies the (optionally altered) payload against the adopted fork.
 */
export async function applySyncPayloadServedBeforeAdoption(
    h: MathPeerTestHarness,
    mutate: (payload: SyncPayload) => void
): Promise<{
    accepted: boolean;
    rejections: string[];
    responderBlacklisted: boolean;
}> {
    const { sourceForkId } = await h.scenario.stageReducibleDisputedFork();
    const observer = h.getPeer(2);
    const source = h.getPeer(0);
    const response = await h.execOnHost(
        observer,
        async (sm, args) =>
            sm.p2pManager.remoteRpc.spectateService
                .onSpectateRequest({ channelId: sm.channelId })
                .request(args.source),
        { source: source.address }
    );
    const payload = Codec.decode(response.encodedSyncPayload, Type.SyncPayload);
    expect(payload.disputeWindows.map((window) => window.forkId)).to.deep.equal(
        [sourceForkId]
    );
    const successorForkId = payload.disputeWindows[0].reducedForkId;
    mutate(payload);

    await h.control(source).stub.startTryReduce(sourceForkId).request();
    await waitFor(
        async () =>
            StateSnapshot.from(
                await h.channelManager.getStateSnapshot(h.channelId)
            ).forkID === successorForkId,
        h.event.protocolEventTimeoutMs()
    );

    const stub = h.control(observer).stub;
    await stub.recordSyncRejections().request();
    try {
        const accepted = await h.execOnHost(
            observer,
            async (sm, args) =>
                sm.p2pManager.localRpc.spectateService.applySyncResponse(
                    args.source,
                    { channelId: sm.channelId },
                    args.encodedSyncPayload
                ),
            {
                source: source.address,
                encodedSyncPayload: Codec.encode(
                    payload,
                    Type.SyncPayload
                ) as string
            }
        );
        return {
            accepted,
            rejections: await stub.restoreRecordedSyncRejections().request(),
            responderBlacklisted: await h
                .control(observer)
                .query.isBlacklisted(source.address)
                .request()
        };
    } finally {
        await stub.restoreRecordedSyncRejections().request();
    }
}

/**
 * Peer 2 applies peer 0's payload for a disputed, not chain-final source fork
 * twice, so its local `reduceAndFinalize` runs: first with that reduction
 * failing at the executor connection, then with the window claiming a
 * reduced fork its reduction does not produce (a revert). Returns the first
 * apply's thrown message, the second verdict, the rejections after each and
 * the responder blacklist after each.
 */
export async function applyDisputedSyncPayloadWithFailingReduction(
    h: MathPeerTestHarness
) {
    const { sourceForkId } = await h.scenario.stageReducibleDisputedFork();
    const observer = h.getPeer(2);
    const source = h.getPeer(0);
    const control = h.control(observer);
    const response = await h.execOnHost(
        observer,
        async (sm, args) =>
            sm.p2pManager.remoteRpc.spectateService
                .onSpectateRequest({
                    channelId: sm.channelId,
                    forkId: args.forkId
                })
                .request(args.source),
        { source: source.address, forkId: sourceForkId }
    );
    const payload = Codec.decode(response.encodedSyncPayload, Type.SyncPayload);
    expect(payload.disputeWindows.map((window) => window.forkId)).to.deep.equal(
        [sourceForkId]
    );
    const apply = (encodedSyncPayload: string) =>
        h.execOnHost(
            observer,
            async (sm, args) =>
                sm.p2pManager.localRpc.spectateService.applySyncResponse(
                    args.source,
                    { channelId: sm.channelId, forkId: args.forkId },
                    args.encodedSyncPayload
                ),
            { source: source.address, forkId: sourceForkId, encodedSyncPayload }
        );
    const blacklisted = () =>
        control.query.isBlacklisted(source.address).request();
    await control.stub.recordSyncRejections().request();
    try {
        await control.stub.failNextLocalReduction().request();
        const thrown = await apply(String(response.encodedSyncPayload)).then(
            () => "",
            (error: unknown) =>
                error instanceof Error ? error.message : String(error)
        );
        const afterThrow = {
            rejections: await control.stub
                .restoreRecordedSyncRejections()
                .request(),
            blacklisted: await blacklisted()
        };
        await control.stub.recordSyncRejections().request();
        payload.disputeWindows[0].reducedForkId = id(
            "not the fork this reduction produces"
        );
        const accepted = await apply(
            Codec.encode(payload, Type.SyncPayload) as string
        );
        return {
            thrown,
            afterThrow,
            accepted,
            afterRevert: {
                rejections: await control.stub
                    .restoreRecordedSyncRejections()
                    .request(),
                blacklisted: await blacklisted()
            }
        };
    } finally {
        await control.stub.restoreRecordedSyncRejections().request();
    }
}

/**
 * Peer 0 serves a payload for the disputed source fork and `forge` alters its
 * one window. The reduction then lands on chain only (the chain snapshot
 * stays on the source fork), so the window is chain-final but not adopted,
 * and peer 2 applies the payload. Returns the verdict and the rejections.
 */
async function applyForgedChainFinalWindow(
    h: MathPeerTestHarness,
    forge: (
        window: SyncPayload["disputeWindows"][number],
        sourceForkId: ForkId
    ) => Promise<void>
): Promise<{ accepted: boolean; rejections: string[] }> {
    const { sourceForkId } = await h.scenario.stageReducibleDisputedFork();
    const observer = h.getPeer(2);
    const source = h.getPeer(0);
    const response = await h.execOnHost(
        observer,
        async (sm, args) =>
            sm.p2pManager.remoteRpc.spectateService
                .onSpectateRequest({
                    channelId: sm.channelId,
                    forkId: args.forkId
                })
                .request(args.source),
        { source: source.address, forkId: sourceForkId }
    );
    const payload = Codec.decode(response.encodedSyncPayload, Type.SyncPayload);
    expect(payload.disputeWindows.map((window) => window.forkId)).to.deep.equal(
        [sourceForkId]
    );
    await forge(payload.disputeWindows[0], sourceForkId);

    expect(
        await h.scenario.finalizeReductionOnChainOnly(1, sourceForkId)
    ).to.equal(true);
    expect(
        StateSnapshot.from(await h.channelManager.getStateSnapshot(h.channelId))
            .forkID
    ).to.equal(sourceForkId);

    const stub = h.control(observer).stub;
    await stub.recordSyncRejections().request();
    try {
        const accepted = await h.execOnHost(
            observer,
            async (sm, args) =>
                sm.p2pManager.localRpc.spectateService.applySyncResponse(
                    args.source,
                    { channelId: sm.channelId, forkId: args.forkId },
                    args.encodedSyncPayload
                ),
            {
                source: source.address,
                forkId: sourceForkId,
                encodedSyncPayload: Codec.encode(
                    payload,
                    Type.SyncPayload
                ) as string
            }
        );
        return {
            accepted,
            rejections: await stub.restoreRecordedSyncRejections().request()
        };
    } finally {
        await stub.restoreRecordedSyncRejections().request();
    }
}

/**
 * A chain-final, not adopted window (see `applyForgedChainFinalWindow`) whose
 * reduction-input inbound list gets a forged successor of its last block.
 * Returns the verdict, the rejections, the forged block's hash and the
 * reduced fork.
 */
export async function applyChainFinalWindowWithForgedInbound(
    h: MathPeerTestHarness
): Promise<{
    accepted: boolean;
    rejections: string[];
    forgedHash: string;
    reducedForkId: ForkId;
}> {
    let forgedHash = "";
    let reducedForkId = "" as ForkId;
    const outcome = await applyForgedChainFinalWindow(h, async (window) => {
        const last = window.inboundMessageBlocksAppliedInReduce.at(-1);
        const snapshotData = window.latestStateSnapshot.snapshotData;
        const forged = {
            previousBlockHash: last
                ? hash(Codec.encode(last, Type.MessageBlock))
                : String(snapshotData.latestInboundMessageBlockHash),
            blockHeight:
                BigInt(
                    last?.blockHeight ??
                        snapshotData.latestInboundMessageBlockHeight
                ) + 1n,
            messages: [],
            totalBalance: snapshotData.totalDeposits,
            timestamp: BigInt(window.latestStateSnapshot.timestamp)
        };
        window.inboundMessageBlocksAppliedInReduce.push(forged);
        forgedHash = hash(Codec.encode(forged, Type.MessageBlock));
        reducedForkId = window.reducedForkId as ForkId;
    });
    return { ...outcome, forgedHash, reducedForkId };
}

/**
 * A chain-final, not adopted window (see `applyForgedChainFinalWindow`) whose
 * reduction-input snapshot is replaced by the source fork's real genesis with
 * a later timestamp: same snapshot data, so it still claims to be that fork's
 * genesis. Returns the verdict, the rejections, the real and forged genesis
 * hashes and the genesis peer 2 stores for the source fork afterwards.
 */
export async function applyChainFinalWindowWithForgedGenesis(
    h: MathPeerTestHarness
): Promise<{
    accepted: boolean;
    rejections: string[];
    realGenesisHash: string;
    forgedGenesisHash: string;
    storedGenesisHash: string | null;
}> {
    // peers exist once the staging inside the apply starts
    const query = () => h.control(h.getPeer(2)).query;
    let realGenesisHash = "";
    let forgedGenesisHash = "";
    let sourceForkId = "" as ForkId;
    const outcome = await applyForgedChainFinalWindow(
        h,
        async (window, forkId) => {
            sourceForkId = forkId;
            realGenesisHash = String(
                await query().getGenesisSnapshotHash(forkId).request()
            );
            const stored = await query()
                .getStateSnapshotStructByHash(realGenesisHash)
                .request();
            const real = StateSnapshot.from(
                Codec.decode(stored!.encodedSnapshot, Type.StateSnapshot)
            );
            const encodedState = await query()
                .getStateMachineState(real.stateMachineStateHash)
                .request();
            const forged = StateSnapshot.from({
                ...real.toStruct(),
                timestamp: BigInt(real.timestamp) + 1n
            });
            expect(forged.isGenesis).to.equal(true);
            forgedGenesisHash = String(forged.hash);
            window.latestStateSnapshot = forged.toStruct();
            window.latestEncodedStateMachineState = encodedState!;
        }
    );
    const storedGenesisHash = await query()
        .getGenesisSnapshotHash(sourceForkId)
        .request();
    return {
        ...outcome,
        realGenesisHash,
        forgedGenesisHash,
        storedGenesisHash: storedGenesisHash && String(storedGenesisHash)
    };
}

/**
 * `requester` asks `responder` for the latest state (no fork), then syncs
 * from it. Returns the error reply ("" when served) and the sync verdict.
 */
export async function requestLatestFrom(
    h: MathPeerTestHarness,
    requester: ReturnType<MathPeerTestHarness["getPeer"]>,
    responder: string
): Promise<{ refusal: string; synced: boolean }> {
    return await h.execOnHost(
        requester,
        async (sm, { source }) => {
            let refusal = "";
            try {
                await sm.p2pManager.remoteRpc.spectateService
                    .onSpectateRequest({ channelId: sm.channelId })
                    .request(source);
            } catch (error) {
                refusal =
                    error instanceof Error ? error.message : String(error);
            }
            const synced = await sm.p2pManager.localRpc.spectateService.sync(
                source,
                sm.channelId
            );
            return { refusal, synced };
        },
        { source: responder },
        { timeoutMs: h.event.hostExecTimeoutMs() }
    );
}

/**
 * Peer 0 builds its payload at each malformed requested height, then at its
 * valid latest height. Returns per height whether a payload came back.
 */
export async function generateAtMalformedHeights(h: MathPeerTestHarness) {
    return await h.execOnHost(h.getPeer(0), async (sm) => {
        const service = sm.p2pManager.localRpc.spectateService;
        const servedAt = async (height: number) =>
            (await service.generateSyncPayload(
                sm.channelId,
                sm.forkId,
                height
            )) !== undefined;
        return {
            negative: await servedAt(-1),
            fractional: await servedAt(1.5),
            unsafe: await servedAt(Number.MAX_SAFE_INTEGER + 1),
            notANumber: await servedAt(Number.NaN),
            latest: await servedAt(
                sm.storage.blocks.getNextBlockHeight(sm.forkId) - 1
            )
        };
    });
}

/**
 * The chain anchor sits above the fork genesis; a held fresh spectator has
 * no installed state. Participant 1 asks it for the latest state. Returns the
 * error reply, the requester's verdict and whether the spectator blacklisted
 * the requester.
 */
export async function requestLatestFromUninstalledResponder(
    h: MathPeerTestHarness
) {
    const { forkId } = await stageAnchoredSyncPayload(h);
    const requester = h.getPeer(1);
    return await withHeldFreshRequester(h, async (responder) => {
        const { refusal, synced } = await requestLatestFrom(
            h,
            requester,
            responder.address
        );
        return {
            forkId: String(forkId),
            refusal,
            synced,
            requesterBlacklisted: await h
                .control(responder)
                .query.isBlacklisted(requester.address)
                .request()
        };
    });
}

/**
 * Participant 0 asks participant 1, whose answer is held, for its exact
 * block. Returns the verdict once the round-trip bound passed, the strikes
 * and blacklist on the responder, and the requester's status.
 */
export async function participantSyncOutlivesRoundTrip(h: MathPeerTestHarness) {
    await h.lifecycle.start(2, 2);
    const requester = h.getPeer(0);
    const responder = h.getPeer(1);
    const release = await h.rpcStub.holdSpectateResponses(responder.index);
    try {
        const synced = await h.execOnHost(
            requester,
            async (sm, a) =>
                sm.p2pManager.localRpc.spectateService.sync(
                    a.source,
                    sm.channelId,
                    sm.forkId,
                    0
                ),
            { source: responder.address },
            { timeoutMs: h.event.hostExecTimeoutMs() }
        );
        const query = h.control(requester).query;
        return {
            synced,
            strikes: await query.getStrikes(responder.address).request(),
            blacklisted: await query.isBlacklisted(responder.address).request(),
            status: await query.getStatus().request()
        };
    } finally {
        await release();
    }
}

/**
 * A spectator synced at blocks 0-1 whose block work and own sync application
 * are then held, so its stored head stays behind while the participants
 * author three more final blocks and peer 0 posts their snapshot. Its local
 * diamond applies that snapshot, so its proof start is above its head.
 * Participant 1 then asks it for the latest state. Returns the spectator's
 * head, the posted height, the refusal, and whether the spectator cut
 * participant 1.
 */
export async function requestLatestFromStaleSpectator(h: MathPeerTestHarness) {
    await h.lifecycle.start(3, 2);
    const spectator = await h.join.addSpectatorWait();
    const work = await h.rpcStub.holdBlockWork(spectator.index, "queueDequeue");
    const sync = await h.rpcStub.holdSpectateSyncApplication(spectator.index);
    try {
        await h.transition.advanceState({
            count: 3,
            waitForFinalization: true,
            waitForPeers: [0, 1, 2]
        });
        const forkId = String(h.activeForkId!);
        const posted = await h.transition.postSnapshotWait({
            peerIndex: 0,
            forkId
        });
        const query = h.control(h.getPeer(spectator.index)).query;
        const spectatorHead = await query
            .getLatestBlockHeight(forkId)
            .request();
        const requester = h.getPeer(1);
        const { refusal } = await requestLatestFrom(
            h,
            requester,
            h.getPeer(spectator.index).address
        );
        return {
            spectatorHead: spectatorHead ?? -1,
            postedHeight: posted!.blockHeight,
            refusal,
            requesterBlacklisted: await query
                .isBlacklisted(requester.address)
                .request()
        };
    } finally {
        await sync.release();
        await work.release();
    }
}

/**
 * The reduction of a disputed fork lands on chain only, so its window is
 * chain-final; a fresh spectator then syncs through it and stores none of
 * the window's reduction input. Participant 0 asks the spectator twice for
 * the latest state. Returns both error replies ("" when served), whether the
 * spectator blacklisted the requester, and the spectator's status after.
 */
export async function requestLatestFromChainFinalSpectator(
    h: MathPeerTestHarness
) {
    const { sourceForkId } = await h.scenario.stageReducibleDisputedFork();
    expect(
        await h.scenario.finalizeReductionOnChainOnly(1, sourceForkId)
    ).to.equal(true);
    const spectator = await h.join.addSpectatorWait();
    const requester = h.getPeer(0);
    const ask = async () =>
        await h.execOnHost(
            requester,
            async (sm, { source }) => {
                try {
                    await sm.p2pManager.remoteRpc.spectateService
                        .onSpectateRequest({ channelId: sm.channelId })
                        .request(source);
                    return "";
                } catch (error) {
                    return error instanceof Error
                        ? error.message
                        : String(error);
                }
            },
            { source: spectator.address },
            { timeoutMs: h.event.hostExecTimeoutMs() }
        );
    const firstRefusal = await ask();
    const secondRefusal = await ask();
    const query = h.control(h.getPeer(spectator.index)).query;
    return {
        sourceForkId: String(sourceForkId),
        firstRefusal,
        secondRefusal,
        requesterBlacklisted: await query
            .isBlacklisted(requester.address)
            .request(),
        spectatorStatus: await query.getStatus().request()
    };
}
