// @spec-test-coverage-ignore: anchored sync staging exercised by explicit SpectateService declarations
import { StateSnapshot } from "@/models";
import type { SyncPayload } from "@/types";
import { Codec, Type } from "@/utils";
import type { MathPeerTestHarness } from "@test/fixtures/MathPeerTestHarness";
import { chainSnapshot } from "@test/fixtures/MilestoneSyncStaging";
import { suppressTimeoutChecks } from "@test/fixtures/OlderDisputeStaging";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { id } from "ethers";

/**
 * Chain snapshot strictly between the fork genesis and the proven target on
 * the same fork; returns peer 0's payload for the target and the anchor.
 */
export async function stageAnchoredSyncPayload(h: MathPeerTestHarness) {
    await h.lifecycle.start(3, 3);
    const forkId = h.activeForkId!;
    const responder = h.getPeer(0);
    const requester = h.getPeer(2);
    expect(
        await h.transition.postSnapshotWait({
            peerIndex: responder.index,
            forkId: String(forkId)
        })
    ).to.not.equal(undefined);
    await h.transition.advanceState({ count: 2, waitForFinalization: true });
    const latestHeight = await h
        .control(responder)
        .query.getLatestBlockHeight(forkId)
        .request();
    const onChainSnapshot = StateSnapshot.from(
        await h.channelManager.getStateSnapshot(h.channelId)
    );
    expect(onChainSnapshot.forkID).to.equal(forkId);
    expect(onChainSnapshot.blockHeight).to.be.greaterThan(0);
    expect(onChainSnapshot.blockHeight).to.be.lessThan(latestHeight!);

    const served = await h
        .control(responder)
        .spectate.generateSyncPayload(h.channelId, forkId, latestHeight!)
        .request({ timeoutMs: h.event.protocolEventTimeoutMs() });
    expect(served).to.not.equal(null);
    const payload = Codec.decode(served!.encodedSyncPayload, Type.SyncPayload);
    return {
        forkId,
        responder,
        requester,
        latestHeight: latestHeight!,
        onChainSnapshot,
        payload
    };
}

/**
 * The staged payload is altered by `mutate` and another participant applies
 * it. Returns the requester's verdict and its recorded rejection reasons.
 */
export async function applyAnchoredSyncPayload(
    h: MathPeerTestHarness,
    mutate: (payload: SyncPayload, onChainSnapshot: StateSnapshot) => void
): Promise<{ accepted: boolean; rejections: string[] }> {
    const {
        forkId,
        responder,
        requester,
        latestHeight,
        onChainSnapshot,
        payload
    } = await stageAnchoredSyncPayload(h);
    mutate(payload, onChainSnapshot);

    const stub = h.control(requester).stub;
    await stub.recordSyncRejections().request();
    try {
        const accepted = await h
            .control(requester)
            .spectate.applySyncResponse(
                responder.address,
                forkId,
                latestHeight,
                Codec.encode(payload, Type.SyncPayload) as string
            )
            .request({ timeoutMs: h.event.protocolEventTimeoutMs() });
        return {
            accepted,
            rejections: await stub.restoreRecordedSyncRejections().request()
        };
    } finally {
        await stub.restoreRecordedSyncRejections().request();
    }
}

/** A forged outbound block that does not link to the on-chain outbound head. */
export function forgedOutboundBlock(
    payload: SyncPayload
): SyncPayload["outboundMessageBlocksOfTheLatestFork"][number] {
    const latest =
        payload.milestoneSnapshots.at(-1) ?? payload.latestForkGenesisSnapshot;
    return {
        previousBlockHash: id("not the on-chain outbound head"),
        blockHeight:
            BigInt(latest.snapshotData.latestOutboundMessageBlockHeight) + 1n,
        messages: [],
        totalBalance: latest.snapshotData.totalWithdrawals,
        timestamp: 1n
    };
}

/**
 * Four participants, blocks 0..1 final. The next writer leaves: its exit is
 * the fork's first outbound block and its exit snapshot lands as the chain
 * anchor. The next writer after it leaves with its exit post held: its exit
 * is the second outbound block, above the anchor. Then `finalBlocks` more
 * final blocks by the two remaining peers. `heldPost` releases the held post.
 */
export async function stageOutboundAroundAnchor(
    h: MathPeerTestHarness,
    options: { finalBlocks: number }
) {
    await h.lifecycle.start(4, 2);
    await suppressTimeoutChecks(h, [0, 1, 2, 3]);
    let remaining = [0, 1, 2, 3];
    const anchoredLeaver = await h.query.getNextPeerToWrite();
    await h.transition.participantLeaveStateTransition({
        leaverIndex: anchoredLeaver.index,
        waitForPeers: remaining
    });
    remaining = remaining.filter((index) => index !== anchoredLeaver.index);
    await waitFor(
        async () =>
            (await chainSnapshot(h)).latestOutboundMessageBlockHeight === 1,
        h.event.protocolEventTimeoutMs()
    );
    const anchor = await chainSnapshot(h);
    const heldLeaver = await h.query.getNextPeerToWrite();
    const heldPost = await h.rpcStub.holdSnapshotPostSend(heldLeaver.index);
    await h.transition.participantLeaveStateTransition({
        leaverIndex: heldLeaver.index,
        waitForPeers: remaining
    });
    remaining = remaining.filter((index) => index !== heldLeaver.index);
    await h.transition.advanceState({
        count: options.finalBlocks,
        waitForPeers: remaining,
        waitForFinalization: true
    });
    await h.assert.sync.peersInSyncWait({ peerIndices: remaining });
    expect(
        (await chainSnapshot(h)).hash,
        "the first exit snapshot stays the chain anchor"
    ).to.equal(anchor.hash);
    return {
        forkId: h.activeForkId!,
        anchor,
        remaining,
        heldLeaver: heldLeaver.index,
        heldPost
    };
}
