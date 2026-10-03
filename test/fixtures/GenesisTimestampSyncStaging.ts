// @spec-test-coverage-ignore: genesis-timestamp sync staging exercised by explicit SpectateService and E2E-Spectate declarations
import { StateSnapshot } from "@/models";
import type { SyncPayload } from "@/types";
import { Codec, Type } from "@/utils";
import type { MathPeerTestHarness } from "@test/fixtures/MathPeerTestHarness";
import {
    applyServedSyncPayload,
    fetchServedSyncPayload
} from "@test/fixtures/PinnedSyncStaging";
import { decodeMathState } from "@test/utils/mathHarnessAbi";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

/**
 * Channel open with no block on chain or in storage; peer 0 serves a
 * genesis-only payload altered by `mutate` and peer 2 applies it. Returns the
 * verdict, rejection reasons and peer 2's stored genesis hash for the fork.
 */
export async function applyGenesisOnlySyncPayload(
    h: MathPeerTestHarness,
    mutate: (payload: SyncPayload) => void
) {
    await h.lifecycle.start(3, 0);
    const forkId = h.activeForkId!;
    const responder = h.getPeer(0);
    const requester = h.getPeer(2);
    const onChainGenesis = StateSnapshot.from(
        await h.channelManager.getStateSnapshot(h.channelId)
    );
    expect(onChainGenesis.forkID).to.equal(forkId);
    expect(onChainGenesis.blockHeight).to.equal(0);

    const payload = await fetchServedSyncPayload(
        h,
        requester,
        responder,
        forkId
    );
    // empty milestone proof before block zero
    expect(payload.milestoneSnapshots.length).to.equal(0);
    expect(payload.disputeWindows.length).to.equal(0);
    mutate(payload);
    const servedGenesisHash = StateSnapshot.from(
        payload.latestForkGenesisSnapshot
    ).hash;

    const { accepted, rejections } = await applyServedSyncPayload(
        h,
        requester,
        responder,
        forkId,
        payload
    );
    const stored = await h
        .control(requester)
        .dispute.getGenesisSnapshotStruct(forkId)
        .request();
    return {
        accepted,
        rejections,
        responderBlacklisted: await h
            .control(requester)
            .query.isBlacklisted(responder.address)
            .request(),
        onChainGenesisHash: onChainGenesis.hash,
        servedGenesisHash,
        storedGenesisHash: stored
            ? StateSnapshot.decode(stored.encodedSnapshot).hash
            : undefined
    };
}

/**
 * Channel open with no block yet; a byzantine peer answers sync with the real
 * genesis one second later and the height-0 writer syncs from it. Returns the
 * peers and the on-chain genesis hash once the sync settled.
 */
export async function syncForgedGenesisBeforeFirstBlock(
    h: MathPeerTestHarness
) {
    await h.lifecycle.start(3, 0);
    const forkId = h.activeForkId!;
    const onChainGenesis = StateSnapshot.from(
        await h.channelManager.getStateSnapshot(h.channelId)
    );
    expect(onChainGenesis.forkID).to.equal(forkId);
    expect(onChainGenesis.blockHeight).to.equal(0);

    const writer = await h
        .control(h.getPeer(0))
        .query.getNextToWrite()
        .request();
    const victim = h.peers.find((peer) => peer.address === writer)!;
    expect(victim, "height-0 writer is a channel peer").to.not.equal(undefined);
    const [responder, observer] = h.peers.filter(
        (peer) => peer.address !== victim.address
    );

    const payload = await fetchServedSyncPayload(h, victim, responder, forkId);
    expect(payload.milestoneSnapshots.length).to.equal(0);
    payload.latestForkGenesisSnapshot.timestamp =
        BigInt(payload.latestForkGenesisSnapshot.timestamp) + 1n;
    const forgedGenesisHash = StateSnapshot.from(
        payload.latestForkGenesisSnapshot
    ).hash;
    // same forkId, other hash -> the forgery is invisible to the time-blind genesis check
    expect(payload.latestForkGenesisSnapshot.forkId).to.equal(forkId);
    expect(forgedGenesisHash).to.not.equal(onChainGenesis.hash);

    await h
        .control(responder)
        .stub.stubSpectatePayload(
            Codec.encode(payload, Type.SyncPayload) as string
        )
        .request();
    try {
        await h
            .control(victim)
            .spectate.startSync(responder.address, forkId)
            .request();
        // settled either way: the responder is cut or the forged genesis is stored
        await waitFor(async () => {
            if (
                await h
                    .control(victim)
                    .query.isBlacklisted(responder.address)
                    .request()
            )
                return true;
            const stored = await h
                .control(victim)
                .dispute.getGenesisSnapshotStruct(forkId)
                .request();
            return (
                !!stored &&
                StateSnapshot.decode(stored.encodedSnapshot).hash ===
                    forgedGenesisHash
            );
        }, h.event.protocolEventTimeoutMs());
    } finally {
        await h.control(responder).stub.restoreSpectateStaleProof().request();
    }
    return {
        forkId,
        victim,
        responder,
        observer,
        onChainGenesisHash: onChainGenesis.hash
    };
}

/**
 * A reducible disputed fork with the chain still on it; a byzantine peer
 * serves the successor genesis one second later to the successor's height-0
 * writer, which syncs from it; then another peer reduces and the chain adopts. Returns
 * the peers and the honest successor genesis hash once every peer installed it.
 */
export async function syncForgedSuccessorGenesisBeforeFirstBlock(
    h: MathPeerTestHarness
) {
    const { sourceForkId } = await h.scenario.stageReducibleDisputedFork();
    const honest = [h.getPeer(0), h.getPeer(2), h.getPeer(3)];
    const served = await fetchServedSyncPayload(
        h,
        honest[1],
        honest[0],
        sourceForkId
    );
    expect(served.disputeWindows.length).to.equal(1);
    const successorForkId = String(served.latestForkGenesisSnapshot.forkId);
    const successorGenesisHash = StateSnapshot.from(
        served.latestForkGenesisSnapshot
    ).hash;
    const successorState = decodeMathState(
        String(served.latestForkGenesisEncodedState)
    );
    const writer =
        successorState.participants[
            Number(successorState.currentTurnIndex) %
                successorState.participants.length
        ];
    const victim = honest.find((peer) => peer.address === writer)!;
    expect(victim, "successor height-0 writer is honest").to.not.equal(
        undefined
    );
    const [responder, observer] = honest.filter(
        (peer) => peer.address !== victim.address
    );

    served.latestForkGenesisSnapshot.timestamp =
        BigInt(served.latestForkGenesisSnapshot.timestamp) + 1n;
    const forgedGenesisHash = StateSnapshot.from(
        served.latestForkGenesisSnapshot
    ).hash;
    await h
        .control(responder)
        .stub.stubSpectatePayload(
            Codec.encode(served, Type.SyncPayload) as string
        )
        .request();
    try {
        await h
            .control(victim)
            .spectate.startSync(responder.address, sourceForkId)
            .request();
        // settled either way: the responder is cut or the forged genesis is stored
        await waitFor(async () => {
            if (
                await h
                    .control(victim)
                    .query.isBlacklisted(responder.address)
                    .request()
            )
                return true;
            const stored = await h
                .control(victim)
                .dispute.getGenesisSnapshotStruct(successorForkId)
                .request();
            return (
                !!stored &&
                StateSnapshot.decode(stored.encodedSnapshot).hash ===
                    forgedGenesisHash
            );
        }, h.event.protocolEventTimeoutMs());
    } finally {
        await h.control(responder).stub.restoreSpectateStaleProof().request();
    }

    await h.control(observer).stub.startTryReduce(sourceForkId).request();
    await waitFor(async () => {
        const forkIds = await Promise.all(
            [victim, observer].map((peer) =>
                h.control(peer).query.getForkId().request()
            )
        );
        const onChainForkId = StateSnapshot.from(
            await h.channelManager.getStateSnapshot(h.channelId)
        ).forkID;
        return [...forkIds, onChainForkId].every(
            (forkId) => forkId === successorForkId
        );
    }, h.event.protocolEventTimeoutMs());
    return {
        successorForkId,
        victim,
        responder,
        observer,
        successorGenesisHash
    };
}
