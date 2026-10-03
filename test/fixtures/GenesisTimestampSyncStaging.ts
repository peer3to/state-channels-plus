// @spec-test-coverage-ignore: genesis-timestamp sync staging exercised by explicit SpectateService and E2E-Spectate declarations
import { StateSnapshot } from "@/models";
import type { SyncPayload } from "@/types";
import { Codec, Type } from "@/utils";
import type { MathPeerTestHarness } from "@test/fixtures/MathPeerTestHarness";
import {
    applyServedSyncPayload,
    fetchServedSyncPayload
} from "@test/fixtures/PinnedSyncStaging";
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
