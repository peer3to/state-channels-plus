// @spec-test-coverage-ignore: monotonic sync-install staging exercised by explicit SpectateService and E2E declarations
import { joinAsPendingParticipant } from "./OlderDisputeStaging";
import { stageSpectatorBehindUnfinalizedTail } from "./SyncReplayBaseStaging";
import { BlockOrigin } from "@/storage/QueueStorage";
import { Status } from "@/types";
import type { ForkId } from "@/types/types";
import { Codec, hash, Type } from "@/utils";
import type { MathPeerTestHarness } from "@test/fixtures/MathPeerTestHarness";
import {
    keepOnlyAuthorSignatures,
    latestHeight,
    missingBlockHeights,
    nextWriters,
    proofHeights,
    servedPayload,
    syncFromResponder
} from "@test/fixtures/MilestoneSyncStaging";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

type Peer = ReturnType<MathPeerTestHarness["getPeer"]>;

type TwoFinalPoints = {
    forkId: ForkId;
    observer: Peer;
    /** Serves its final point at the tip. */
    ahead: Peer;
    /** Serves the final point `baseHeight` and the tail up to the tip. */
    behind: Peer;
    baseHeight: number;
    tip: number;
    /** Hash of the state at `baseHeight`. */
    baseStateHash: string;
};

/**
 * Two honest sources with different final points on one fork, and an
 * observer below both. `stageSpectatorBehindUnfinalizedTail` leaves the
 * observer one height below the final point b, both tail writers holding
 * b+1..tip unfinalized, and the third writer blind. The observer and the
 * second tail writer (`behind`) then drop network confirmations, and the
 * third writer takes the tail through its control port and signs it: only
 * the first tail writer (`ahead`) finalizes up to the tip. With
 * `pendingJoiner`, the observer then joins: a pending participant whose
 * join no block consumes yet.
 */
async function stageSourcesAtTwoFinalPoints(
    h: MathPeerTestHarness,
    pendingJoiner: boolean
): Promise<TwoFinalPoints> {
    const {
        forkId,
        spectator: observer,
        responder: ahead,
        tip
    } = await stageSpectatorBehindUnfinalizedTail(h, {
        finalBlocksWhileCutOff: 1
    });
    const [silentIndex] = await nextWriters(h, ahead.index, 1);
    const silent = h.getPeer(silentIndex);
    const behind = h.peers.find(
        (peer) =>
            [0, 1, 2].includes(peer.index) &&
            peer.index !== ahead.index &&
            peer.index !== silent.index
    )!;
    await h.rpcStub.suppressTimeoutCheck(observer.index);
    await h.control(observer).stub.recordConfirmationOperations().request();
    await h.rpcStub.dropNetworkConfirmations(observer.index);
    await h.rpcStub.dropNetworkConfirmations(behind.index);
    const behindPayload = await servedPayload(h, behind, forkId);
    const baseHeight = proofHeights(behindPayload).at(-1)![0];
    // premise - the observer stands below the base; behind serves the tail
    expect(await latestHeight(h, observer, forkId)).to.equal(baseHeight - 1);
    expect(proofHeights(behindPayload).at(-1)).to.deep.equal([
        baseHeight,
        baseHeight + 1,
        tip
    ]);

    await h.control(silent).stub.restoreDropNetworkConfirmations().request();
    for (let height = baseHeight + 1; height <= tip; height++) {
        const bundle = (await h
            .control(ahead)
            .query.getBlockByHeight(forkId, height)
            .request())!;
        await h.transition.ingestBlockConfirmationWait({
            peerIndex: silent.index,
            blockConfirmation: Codec.decode(
                bundle.encodedBlockConfirmation,
                Type.BlockConfirmation
            ),
            ingestOptions: {
                origin: BlockOrigin.NETWORK,
                senderAddress: ahead.address
            },
            keepConnection: true
        });
    }
    await waitFor(
        async () =>
            (await h
                .control(ahead)
                .query.didEveryoneSignBlockAt(forkId, tip)
                .request()) === true,
        h.event.protocolEventTimeoutMs()
    );
    // premise - ahead's final point is the tip, behind's is still the base
    expect(
        proofHeights(await servedPayload(h, ahead, forkId)).at(-1)
    ).to.deep.equal([tip]);
    expect(
        proofHeights(await servedPayload(h, behind, forkId)).at(-1)![0]
    ).to.equal(baseHeight);

    if (pendingJoiner)
        await joinAsPendingParticipant(h, observer.index, [0, 1, 2]);
    return {
        forkId,
        observer,
        ahead,
        behind,
        baseHeight,
        tip,
        baseStateHash: hash(behindPayload.latestFinalizedEncodedState)
    };
}

/**
 * After the observer installed the tip from `ahead`, its tip keeps only the
 * author's signature, and the block below it is one the observer never
 * held: the observer cannot prove its own tip final, as when its history
 * has gaps, so `behind`'s proof is walked from below the base and its
 * replay base is `behind`'s final point.
 */
async function forgetTipFinality(
    h: MathPeerTestHarness,
    staged: TwoFinalPoints
): Promise<void> {
    const { forkId, observer, baseHeight, tip } = staged;
    expect(
        await missingBlockHeights(h, observer, forkId, baseHeight + 1, tip)
    ).to.deep.equal([baseHeight + 1]);
    await keepOnlyAuthorSignatures(h, observer.index, forkId, [tip]);
}

/** The observer's VM state is the one `ahead` holds at the same height. */
async function expectObserverStateMatchesAhead(
    h: MathPeerTestHarness,
    staged: TwoFinalPoints
): Promise<void> {
    const { forkId, observer, ahead } = staged;
    const height = await latestHeight(h, observer, forkId);
    expect(await latestHeight(h, ahead, forkId)).to.equal(height);
    const vmState = (peer: Peer) =>
        h.execOnHost(peer, (sm) => sm.diamondStateMachine.getState());
    expect(await vmState(observer)).to.equal(await vmState(ahead));
    expect(
        await h
            .control(observer)
            .query.getLatestStateMachineStateHash(forkId)
            .request()
    ).to.equal(
        await h
            .control(ahead)
            .query.getLatestStateMachineStateHash(forkId)
            .request()
    );
}

/**
 * Network confirmations flow again and the participants author `count`
 * live blocks; the observer executes each of them with no fraud proof, no
 * dispute and no source cut, and ends at `status`.
 */
async function expectObserverExecutesLiveBlocks(
    h: MathPeerTestHarness,
    staged: TwoFinalPoints,
    status: Status
): Promise<void> {
    const { forkId, observer, ahead, behind, tip } = staged;
    const control = h.control(observer);
    await control.stub.restoreDropNetworkConfirmations().request();
    await h.control(behind).stub.restoreDropNetworkConfirmations().request();
    const count = 3;
    await h.transition.advanceState({
        count,
        waitForPeers: [0, 1, 2, observer.index]
    });
    expect(await latestHeight(h, observer, forkId)).to.be.at.least(tip + count);
    await expectObserverStateMatchesAhead(h, staged);
    for (const participant of [0, 1, 2].map((index) => h.getPeer(index))) {
        expect(
            await control.query.getFraudProofType(participant.address).request()
        ).to.equal(null);
        expect(
            await control.query.isBlacklisted(participant.address).request()
        ).to.equal(false);
    }
    expect(await control.query.didIDispute(forkId).request()).to.equal(false);
    expect(await control.query.getStatus().request()).to.equal(status);
    expect(await control.query.isBlacklisted(ahead.address).request()).to.equal(
        false
    );
}

/**
 * The observer syncs from `ahead` and installs the tip: it never computes
 * the state at the base. It then syncs from `behind`, whose payload is
 * based there: the observer keeps its own state (no install), drops the
 * replayed block it never had and merges the stored one, and executes the
 * next live blocks. A pending joiner stays pending, disputes nothing, and
 * is seated by the next live block.
 */
export async function assertStaleBaseKeepsLocalState(
    h: MathPeerTestHarness,
    pendingJoiner: boolean
): Promise<void> {
    const staged = await stageSourcesAtTwoFinalPoints(h, pendingJoiner);
    const { forkId, observer, ahead, behind, baseHeight, tip } = staged;
    const status = pendingJoiner ? Status.PENDING_PARTICIPANT : Status.SYNCED;
    const control = h.control(observer);
    expect(await control.query.getStatus().request()).to.equal(status);

    expect(
        await syncFromResponder(h, observer, ahead, forkId, tip)
    ).to.deep.equal({
        synced: true,
        rejections: [],
        blacklisted: false,
        latestHeight: tip
    });
    // premise - the observer jumped past the base without its state
    expect(
        await control.query.getStateMachineState(staged.baseStateHash).request()
    ).to.equal(null);
    await forgetTipFinality(h, staged);

    await control.stub.stubRecordUnsafeSetLatestState().request();
    try {
        expect(
            await syncFromResponder(h, observer, behind, forkId, tip)
        ).to.deep.equal({
            synced: true,
            rejections: [],
            blacklisted: false,
            latestHeight: tip
        });
        expect(
            await control.stub.wasUnsafeSetLatestStateCalled().request(),
            "an older base must not be installed over a later local height"
        ).to.equal(false);
    } finally {
        await control.stub.restoreUnsafeSetLatestState().request();
    }
    // the replayed block the observer never had is dropped, not stored
    expect(
        await missingBlockHeights(h, observer, forkId, baseHeight + 1, tip)
    ).to.deep.equal([baseHeight + 1]);
    expect(await control.query.getStatus().request()).to.equal(status);
    await expectObserverStateMatchesAhead(h, staged);
    // the next live block consumes a pending joiner's join
    await expectObserverExecutesLiveBlocks(
        h,
        staged,
        pendingJoiner ? Status.PARTICIPATING : Status.SYNCED
    );
}

/**
 * The log's race. The observer takes the tip block from `ahead` and
 * `behind` (its author); its queue entry expires and probes both. The
 * application of `behind`'s answer (based at the final point below the
 * tip) is held until `ahead`'s sync installed the tip, then released: the
 * observer keeps its state, cuts no source, and executes the next live
 * blocks.
 */
export async function assertTwoSourceProbeKeepsLocalState(
    h: MathPeerTestHarness
): Promise<void> {
    const staged = await stageSourcesAtTwoFinalPoints(h, false);
    const { forkId, observer, ahead, behind, tip } = staged;
    const control = h.control(observer);
    const held = await h.rpcStub.holdSpectateSyncApplication(
        observer.index,
        behind.index
    );
    try {
        const tipBlock = (await h
            .control(ahead)
            .query.getBlockByHeight(forkId, tip)
            .request())!;
        for (const source of [ahead, behind])
            await h.transition.ingestBlockConfirmationWait({
                peerIndex: observer.index,
                blockConfirmation: Codec.decode(
                    tipBlock.encodedBlockConfirmation,
                    Type.BlockConfirmation
                ),
                ingestOptions: {
                    origin: BlockOrigin.NETWORK,
                    senderAddress: source.address
                },
                keepConnection: true,
                waitForProcessed: false
            });
        await waitFor(
            async () =>
                (await held.entered()) === 1 &&
                (await latestHeight(h, observer, forkId)) === tip,
            h.event.protocolEventTimeoutMs()
        );
        // premise - ahead's sync installed the tip without the base state
        expect(
            await control.query
                .getStateMachineState(staged.baseStateHash)
                .request()
        ).to.equal(null);
        await forgetTipFinality(h, staged);
        await control.stub.stubRecordUnsafeSetLatestState().request();
        await held.release();
        await waitFor(
            async () => (await held.results()).length === 1,
            h.event.protocolEventTimeoutMs()
        );
        expect(await held.results()).to.deep.equal([true]);
        expect(
            await control.stub.wasUnsafeSetLatestStateCalled().request(),
            "an older base must not be installed over a later local height"
        ).to.equal(false);
    } finally {
        await held.release();
        await control.stub.restoreUnsafeSetLatestState().request();
    }
    await expectObserverStateMatchesAhead(h, staged);
    await expectObserverExecutesLiveBlocks(h, staged, Status.SYNCED);
}
