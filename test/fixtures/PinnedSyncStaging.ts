// @spec-test-coverage-ignore: pinned sync staging exercised by explicit component and E2E declarations
import StateSnapshot from "@/models/StateSnapshot";
import type { SyncPayload } from "@/types";
import type { ForkId } from "@/types/types";
import { Codec, Type } from "@/utils";
import type { MathPeerTestHarness } from "@test/fixtures/MathPeerTestHarness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { ZeroHash } from "ethers";

export async function assertComputedSuccessorSync(
    h: MathPeerTestHarness,
    requestSuccessor: boolean
): Promise<void> {
    const { sourceForkId } = await h.scenario.stageReducibleDisputedFork();
    const source = h.getPeer(0);
    const observer = h.getPeer(2);
    const hold = await h.rpcStub.holdReductionGenesisApplication(0, {
        outcome: "hold",
        at: "setState"
    });
    try {
        const successor = await holdComputedSuccessor(
            h,
            source,
            sourceForkId,
            hold
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
        const accepted = await h.execOnHost(
            observer,
            async (sm, args) =>
                sm.p2pManager.localRpc.spectateService.sync(
                    args.source,
                    sm.channelId,
                    args.forkId
                ),
            {
                source: source.address,
                forkId: requestSuccessor ? successor : sourceForkId
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

/**
 * Start `source`'s reduction of `forkId` with its genesis application held
 * at `setState`, and return the successor fork it computed: `source` serves
 * that fork without having installed it.
 */
async function holdComputedSuccessor(
    h: MathPeerTestHarness,
    source: ReturnType<MathPeerTestHarness["getPeer"]>,
    forkId: ForkId,
    hold: { entered: () => Promise<number> }
): Promise<ForkId> {
    await h.control(source).stub.startTryReduce(forkId).request();
    await waitFor(async () => (await hold.entered()) === 1);
    return await h.execOnHost(
        source,
        async (sm, args) => {
            const disputes = await sm.agreementManager.getForkDisputes(
                (await sm.eventSyncService.loadSynchronizedWindowCommitments(
                    sm.channelId,
                    args.forkId
                ))!
            );
            return (await sm.reductionManager.computeReductionLocally(
                args.forkId,
                disputes
            ))!.reducedForkId;
        },
        { forkId }
    );
}

/**
 * The observer syncs onto a successor fork and a read of its install fails
 * after the VM write: the sync throws, and none of the payload's history is
 * stored, the VM keeps its state and the fork stays.
 */
export async function assertFailedSyncInstallPersistsNothing(
    h: MathPeerTestHarness
): Promise<void> {
    const { sourceForkId } = await h.scenario.stageReducibleDisputedFork();
    const source = h.getPeer(0);
    const observer = h.getPeer(2);
    const hold = await h.rpcStub.holdReductionGenesisApplication(0, {
        outcome: "hold",
        at: "setState"
    });
    try {
        const successor = await holdComputedSuccessor(
            h,
            source,
            sourceForkId,
            hold
        );
        const outcome = await h.execOnHost(
            observer,
            async (sm, args) => {
                const application = sm.stateApplicationService;
                const machine = sm.diamondStateMachine;
                const install = application.unsafeSetLatestState;
                const read = machine.getNextToWrite;
                let installing = false;
                application.unsafeSetLatestState = async (...parameters) => {
                    installing = true;
                    try {
                        return await install.apply(application, parameters);
                    } finally {
                        installing = false;
                    }
                };
                machine.getNextToWrite = async () => {
                    if (installing)
                        throw new Error("Injected install read failure");
                    return await read.call(machine);
                };
                const stateBefore = String(await machine.getState());
                let threw = "";
                try {
                    await sm.p2pManager.localRpc.spectateService.sync(
                        args.source,
                        sm.channelId,
                        args.forkId
                    );
                } catch (error) {
                    threw = String(error);
                } finally {
                    application.unsafeSetLatestState = install;
                    machine.getNextToWrite = read;
                }
                return {
                    threw,
                    forkId: sm.forkId,
                    vmRestored:
                        String(await machine.getState()) === stateBefore,
                    successorGenesisStored:
                        sm.storage.stateSnapshots.getGenesisSnapshotByForkId(
                            args.successor
                        ) !== undefined
                };
            },
            {
                source: source.address,
                forkId: sourceForkId,
                successor
            }
        );
        expect(outcome).to.deep.equal({
            threw: "Error: Injected install read failure",
            forkId: sourceForkId,
            vmRestored: true,
            successorGenesisStored: false
        });
        expect(
            await h
                .control(observer)
                .query.isBlacklisted(source.address)
                .request()
        ).to.equal(false);
    } finally {
        await hold.release();
    }
}

/**
 * The observer's sync onto the successor is held at its install entry while
 * a successor block, authored after the payload was served, waits in its
 * queue. The block's queue timeout runs inside that window and must see an
 * unknown fork (probe), not a known stale one (silent drop): no successor
 * history is visible before the fork swap. After the install the probe
 * stores the block on the successor.
 */
export async function assertQueuedSuccessorBlockSurvivesSyncInstall(
    h: MathPeerTestHarness
): Promise<void> {
    const { sourceForkId } = await h.scenario.stageReducibleDisputedFork();
    const source = h.getPeer(0);
    const followers = [h.getPeer(2), h.getPeer(3)];
    const races = await Promise.all(
        followers.map((peer) => h.rpcStub.holdReductionRace(peer.index))
    );
    const reduce = async (peer: typeof source) => {
        await h.control(peer).stub.startTryReduce(sourceForkId).request();
        await waitFor(
            async () =>
                (await h.control(peer).query.getForkId().request()) !==
                sourceForkId
        );
    };
    await reduce(source);
    const successor = await h.control(source).query.getForkId().request();
    const writerAddress = await h
        .control(source)
        .query.getNextToWrite()
        .request();
    const writer = [source, ...followers].find(
        (peer) => peer.address === writerAddress
    );
    // premise: an honest peer writes the successor's first block
    expect(writer, "successor writer").to.not.be.undefined;
    if (writer !== source) await reduce(writer!);
    // the observer stays on the source fork until its sync
    const observer = followers.find((peer) => peer !== writer)!;
    const stub = h.control(observer).stub;
    const recovery = await h.rpcStub.holdScheduledTasks(
        observer.index,
        "BlockQueueManager.runForkRecovery"
    );
    const timeouts = await h.rpcStub.holdScheduledTasks(
        observer.index,
        "BlockQueueManager.queueTimeout"
    );
    try {
        await stub.holdSyncInstall().request();
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
        await waitFor(
            async () => (await stub.getSyncInstallEntered().request()) === 1
        );
        await h.transition.submit(writer!, (contract) => contract.add(1), {
            waitForTurn: true,
            waitForSync: false
        });
        let blockHash: string | null = null;
        await waitFor(async () => {
            blockHash = await h
                .control(writer!)
                .query.getBlockHashAt(successor, 0)
                .request();
            return (
                blockHash !== null &&
                (await h
                    .control(observer)
                    .query.isBlockQueued(blockHash)
                    .request())
            );
        });
        // each copy of the block re-arms its timeout: every arm is held
        await waitFor(async () => (await timeouts.heldCount()) > 0);

        // the queue timeout runs while the install is held
        await timeouts.release(true);
        await waitFor(
            async () =>
                (await h.execOnHost(
                    observer,
                    async (sm) => sm.blockQueueManager["inFlight"].size
                )) > 0
        );
        expect(
            await h.execOnHost(
                observer,
                async (sm, args) => ({
                    forkId: sm.forkId,
                    knownStale: await sm.validationService.isKnownStaleFork(
                        args.successor
                    )
                }),
                { successor }
            )
        ).to.deep.equal({ forkId: sourceForkId, knownStale: false });

        await stub.releaseSyncInstall().request();
        expect(await sync).to.equal(true);
        await waitFor(
            async () =>
                (await h
                    .control(observer)
                    .query.getBlockByHash(blockHash!)
                    .request()) !== null
        );
        expect(await h.control(observer).query.getForkId().request()).to.equal(
            successor
        );
        for (const peer of [source, writer!])
            expect(
                await h
                    .control(observer)
                    .query.isBlacklisted(peer.address)
                    .request()
            ).to.equal(false);
    } finally {
        await stub.releaseSyncInstall().request();
        await timeouts.release(false);
        await recovery.release(false);
        for (const race of races)
            await race.release({ replayEvents: false, keepTasksHeld: true });
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
    await h
        .control(observer)
        .stub.holdSyncWindowPersistence("afterPersist")
        .request();
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
        await stub.holdSyncWindowPersistence("afterPersist").request();
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
 * A follower stays on the disputed source fork while the source peer serves
 * the successor. The follower's sync onto the successor is held at its
 * install entry, and a timeout check for the follower's next source-fork
 * height fires in that window: it waits for the install on the state mutex.
 * After the install the source fork is no longer active, so the check
 * stores no timeout and submits nothing.
 */
export async function assertTimeoutCheckWaitsForSyncInstall(
    h: MathPeerTestHarness
): Promise<void> {
    const { sourceForkId } = await h.scenario.stageReducibleDisputedFork();
    const source = h.getPeer(0);
    const followers = [h.getPeer(2), h.getPeer(3)];
    const races = await Promise.all(
        followers.map((peer) => h.rpcStub.holdReductionRace(peer.index))
    );
    await h.control(source).stub.startTryReduce(sourceForkId).request();
    await waitFor(
        async () =>
            (await h.control(source).query.getForkId().request()) !==
            sourceForkId
    );
    const { height, writer } = await h.execOnHost(followers[0], async (sm) => ({
        height: sm.storage.blocks.getNextBlockHeight(sm.forkId),
        writer: await sm.diamondStateMachine.getNextToWrite()
    }));
    // the check judges another participant
    const observer = followers.find((peer) => peer.address !== writer)!;
    const recorder = await h.rpcStub.recordDisputeSubmissions(observer.index);
    const stub = h.control(observer).stub;
    try {
        await stub.holdSyncInstall().request();
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
        await waitFor(
            async () => (await stub.getSyncInstallEntered().request()) === 1
        );
        const waiting = await stub.getStateMutexWaiterCount().request();
        const check = h.execOnHost(
            observer,
            (sm, args) =>
                sm.participantTimeoutService["tryTimeoutParticipant"](
                    args.forkId,
                    args.height,
                    args.writer
                ),
            { forkId: sourceForkId, height, writer },
            { timeoutMs: h.event.hostExecTimeoutMs() }
        );
        // the check waits for the held install on the state mutex
        await waitFor(
            async () =>
                (await stub.getStateMutexWaiterCount().request()) > waiting
        );
        await stub.releaseSyncInstall().request();
        expect(await sync).to.equal(true);
        await check;
        expect(
            await h.control(observer).query.getForkId().request()
        ).to.not.equal(sourceForkId);
        expect(await recorder.submissions()).to.deep.equal([]);
        expect(
            await h.control(observer).query.getTimeout(sourceForkId).request()
        ).to.equal(null);
    } finally {
        await stub.releaseSyncInstall().request();
        await recorder.restore();
        for (const race of races)
            await race.release({ replayEvents: false, keepTasksHeld: true });
    }
}
