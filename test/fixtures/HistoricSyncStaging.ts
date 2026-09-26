// @spec-test-coverage-ignore: anchored sync staging exercised by explicit SpectateService declarations
import { StateSnapshot } from "@/models";
import type { SyncPayload } from "@/types";
import { Codec, Type } from "@/utils";
import type { MathPeerTestHarness } from "@test/fixtures/MathPeerTestHarness";
import { expect } from "chai";
import { id } from "ethers";

/**
 * Chain snapshot strictly between the fork genesis and the proven target on
 * the same fork; a participant serves a payload for the target, the payload is
 * altered by `mutate`, and another participant applies it. Returns the
 * requester's verdict and its recorded rejection reasons.
 */
export async function applyAnchoredSyncPayload(
    h: MathPeerTestHarness,
    mutate: (payload: SyncPayload, onChainSnapshot: StateSnapshot) => void
): Promise<{ accepted: boolean; rejections: string[] }> {
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
    mutate(payload, onChainSnapshot);

    const stub = h.control(requester).stub;
    await stub.recordSyncRejections().request();
    try {
        const accepted = await h
            .control(requester)
            .spectate.applySyncResponse(
                responder.address,
                forkId,
                latestHeight!,
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
