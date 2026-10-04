// @spec-test-coverage-ignore: sync verification and completion staging exercised by explicit E2E-Spectate declarations
import { Block, StateSnapshot } from "@/models";
import type { SyncPayload } from "@/types";
import type { ForkId } from "@/types/types";
import { Codec, Type } from "@/utils";
import {
    forgeSyncPayloads,
    prependMilestoneAt
} from "@test/fixtures/HistoricSyncStaging";
import type { MathPeerTestHarness } from "@test/fixtures/MathPeerTestHarness";
import {
    chainSnapshot,
    deleteStoredBlocks,
    postSnapshotAt,
    restoreStoredBlocks,
    stageLeftChannel
} from "@test/fixtures/StateProofConstructionStaging";
import {
    servedPayload,
    syncSpectatorOnServedPayload
} from "@test/fixtures/SyncCompletionStaging";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

type Peer = ReturnType<MathPeerTestHarness["getPeer"]>;

const encode = (payload: SyncPayload) =>
    Codec.encode(payload, Type.SyncPayload) as string;

/**
 * `responder` answers every spectate request with `encodedSyncPayload`
 * while `requester` runs one real sync toward it, pinned to `forkId` at
 * `blockHeight`. Returns the sync verdict, the requester's rejection
 * reasons, whether it blacklisted the responder, and its head after.
 */
export async function syncFromServedPayload(
    h: MathPeerTestHarness,
    requester: Peer,
    responder: Peer,
    encodedSyncPayload: string,
    forkId: ForkId,
    blockHeight: number
) {
    const control = h.control(requester);
    await h
        .control(responder)
        .stub.stubSpectatePayload(encodedSyncPayload)
        .request();
    await control.stub.recordSyncRejections().request();
    try {
        const synced = await control.spectate
            .sync(responder.address, forkId, blockHeight)
            .request({ timeoutMs: h.event.protocolEventTimeoutMs() });
        return {
            synced,
            rejections: await control.stub
                .restoreRecordedSyncRejections()
                .request(),
            blacklisted: await control.query
                .isBlacklisted(responder.address)
                .request(),
            latestHeight: await control.query
                .getLatestBlockHeight(forkId)
                .request()
        };
    } finally {
        await control.stub.restoreRecordedSyncRejections().request();
        await h.control(responder).stub.restoreSpectateStaleProof().request();
    }
}

/** Both peers hold an open connection to each other. */
async function waitForMutualConnection(
    h: MathPeerTestHarness,
    a: Peer,
    b: Peer
): Promise<void> {
    await waitFor(
        async () =>
            (await h.control(a).query.isConnectedTo(b.address).request()) &&
            (await h.control(b).query.isConnectedTo(a.address).request()),
        h.event.protocolEventTimeoutMs()
    );
}

/**
 * Three participants author three final blocks; a fresh spectator's next
 * local-diamond `verifyMilestones` read fails at the executor connection,
 * then it connects: its initial sync meets that failure. Returns once the
 * spectator has aborted.
 */
export async function failInitialSyncVerification(h: MathPeerTestHarness) {
    await h.lifecycle.start(3, 3);
    const forkId = h.activeForkId!;
    const latestHeight = await h
        .control(h.getPeer(0))
        .query.getLatestBlockHeight(forkId)
        .request();
    const spectator = h.getPeer((await h.join.createSpectatorPeer()).index);
    // the observation dies with the aborted runtime
    await h.mirror.observe(spectator.index, "verifyMilestones");
    await h.mirror.failNextLocalRead(
        spectator.index,
        "verifyMilestones",
        "transport"
    );
    await h.join.connectSpectator(spectator);
    await h.event.waitForPeers("onAbort", [spectator.index], 1);
    return {
        spectator,
        participants: [0, 1, 2].map((index) => h.getPeer(index)),
        forkId,
        latestHeight: latestHeight!
    };
}

/**
 * Three participants author three final blocks; peer 1's payload for that
 * head is kept (its history ends below the spectator's later final point).
 * A spectator syncs, follows two more final blocks (its threshold-final
 * point, `finalHeight`), and is isolated while the participants author one
 * more final block (`latestHeight`). It reconnects to every participant
 * still at `finalHeight`.
 */
export async function stageLaggingSpectator(h: MathPeerTestHarness) {
    await h.lifecycle.start(3, 3);
    const forkId = h.activeForkId!;
    const participants = [0, 1, 2];
    const earlyPayload = await servedPayload(h, h.getPeer(1), forkId);
    const spectator = h.getPeer((await h.join.addSpectatorWait()).index);
    // every peer, the spectator included, sees both blocks final
    await h.transition.advanceState({ count: 2, waitForFinalization: true });
    const query = h.control(spectator).query;
    const finalHeight = (await query.getLatestBlockHeight(forkId).request())!;
    await h.network.blacklistAndDisconnectPeer(spectator.index);
    await h.transition.advanceState({
        count: 1,
        waitForPeers: participants,
        waitForFinalization: true
    });
    const latestHeight = (await h
        .control(h.getPeer(0))
        .query.getLatestBlockHeight(forkId)
        .request())!;
    await h.network.reconnectPeers([spectator.index]);
    for (const index of participants)
        await waitForMutualConnection(h, spectator, h.getPeer(index));
    expect(
        await query.getLatestBlockHeight(forkId).request(),
        "the spectator still lags"
    ).to.equal(finalHeight);
    expect(latestHeight).to.be.greaterThan(finalHeight);
    return {
        spectator,
        forkId,
        finalHeight,
        latestHeight,
        encodedEarlyPayload: encode(earlyPayload)
    };
}

/**
 * The payload `responder` serves while its blocks from `fromHeight` to its
 * head carry only their authors' signatures: those blocks reach no
 * threshold, so its last milestone starts at an earlier threshold-final
 * block, and the served state is that block's state. The blocks get their
 * signatures back afterwards. Returns the payload encoded.
 */
export async function servedEarlierStatePayload(
    h: MathPeerTestHarness,
    responder: Peer,
    forkId: ForkId,
    fromHeight: number
) {
    const latestHeight = (await h
        .control(responder)
        .query.getLatestBlockHeight(forkId)
        .request())!;
    const heights = Array.from(
        { length: latestHeight - fromHeight + 1 },
        (_, offset) => fromHeight + offset
    );
    const removed = await deleteStoredBlocks(h, responder.index, heights, true);
    let payload: SyncPayload;
    try {
        payload = await servedPayload(h, responder, forkId);
    } finally {
        await restoreStoredBlocks(h, responder.index, removed);
    }
    const lastRun = payload.stateProof.milestones
        .at(-1)!
        .blockConfirmations.map((c) => Block.fromBlockConfirmation(c).height);
    expect(lastRun.at(-1)).to.equal(latestHeight);
    expect(lastRun[0], "an earlier served state").to.be.lessThan(fromHeight);
    return encode(payload);
}

/**
 * The honest `payload` with its adopted (last milestone) snapshot forged.
 * Returns it encoded with the forged snapshot's hash.
 */
export async function forgedAdoptedStatePayload(
    h: MathPeerTestHarness,
    payload: SyncPayload
) {
    const { finality } = forgeSyncPayloads(payload, await chainSnapshot(h), [
        "finality"
    ]);
    const forged = Codec.decode(finality, Type.SyncPayload);
    return {
        encodedSyncPayload: finality,
        forgedSnapshotHash: String(
            StateSnapshot.from(forged.milestoneSnapshots.at(-1)!).hash
        )
    };
}

/**
 * A copy of the honest `payload` with an unused placeholder milestone
 * prepended at `height` (below the requester's start, so its walk drops it).
 * Returns it encoded with the hashes of the planted block and snapshot.
 */
export function placeholderPayload(payload: SyncPayload, height: number) {
    const copy = Codec.decode(encode(payload), Type.SyncPayload);
    const { planted, plantedSnapshot } = prependMilestoneAt(copy, height);
    return {
        encodedSyncPayload: encode(copy),
        plantedHash: String(Block.fromBlockConfirmation(planted).hash),
        plantedSnapshotHash: String(StateSnapshot.from(plantedSnapshot).hash)
    };
}

/**
 * Three participants; peer 0 posts a same-fork snapshot at height 2 (the
 * proof start), then four more final blocks follow. A fresh spectator syncs
 * through the normal path.
 */
export async function stageCompactSyncedSpectator(h: MathPeerTestHarness) {
    await h.lifecycle.start(3, 3);
    const anchor = await postSnapshotAt(h, 0, 2);
    await h.transition.advanceState({ count: 4, waitForFinalization: true });
    const forkId = h.activeForkId!;
    const latestHeight = (await h
        .control(h.getPeer(0))
        .query.getLatestBlockHeight(forkId)
        .request())!;
    const spectator = h.getPeer((await h.join.addSpectatorWait()).index);
    return {
        spectator,
        forkId,
        anchorHeight: anchor.blockHeight,
        latestHeight
    };
}

/**
 * `stageLeftChannel` (a fully signed leave at block 2, two final blocks
 * after it, the exit unposted). Every peer serves a remaining
 * participant's payload, and a fresh spectator syncs through the normal
 * path.
 */
export async function syncSpectatorAfterUnpostedLeave(h: MathPeerTestHarness) {
    const { remaining, changeHeight } = await stageLeftChannel(h);
    const forkId = h.activeForkId!;
    const payload = await servedPayload(h, h.getPeer(remaining[0]), forkId);
    const spectator = await syncSpectatorOnServedPayload(h, payload);
    const latestHeight = (await h
        .control(h.getPeer(remaining[0]))
        .query.getLatestBlockHeight(forkId)
        .request())!;
    return { spectator, remaining, changeHeight, forkId, latestHeight };
}

/** Heights in `[from, to]` the peer holds no block at. */
export async function missingBlockHeights(
    h: MathPeerTestHarness,
    peer: Peer,
    forkId: ForkId,
    from: number,
    to: number
): Promise<number[]> {
    const missing: number[] = [];
    for (let height = from; height <= to; height++)
        if (
            (await h
                .control(peer)
                .query.getBlockHashAt(forkId, height)
                .request()) === null
        )
            missing.push(height);
    return missing;
}
