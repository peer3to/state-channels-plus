// @spec-test-coverage-ignore: pinned sync staging exercised by explicit component and E2E declarations
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
    expect(
        await h.control(requester).query.isBlacklisted(source.address).request()
    ).to.equal(offset > 0);
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
