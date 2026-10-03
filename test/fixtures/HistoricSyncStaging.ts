// @spec-test-coverage-ignore: anchored sync staging exercised by explicit SpectateService declarations
import { StateSnapshot } from "@/models";
import type { SyncPayload } from "@/types";
import type { ForkId } from "@/types/types";
import { Codec, Type } from "@/utils";
import type { HarnessControlRpc } from "@test/fixtures/customRpc/harnessControl/HarnessControlRpc";
import type { MathPeerTestHarness } from "@test/fixtures/MathPeerTestHarness";
import type { TestPeer } from "@test/harness/core/types";
import type { MathStateMachine } from "@typechain-types";
import { expect } from "chai";
import { id } from "ethers";

/**
 * Chain snapshot strictly between the fork genesis and the proven target on
 * the same fork; returns peer 0's payload for the target and the anchor.
 */
export async function stageAnchoredSyncPayload(h: MathPeerTestHarness) {
    await h.lifecycle.start(3, 3);
    return {
        responder: h.getPeer(0),
        requester: h.getPeer(2),
        ...(await postAnchorAndServePayload(h, h.getPeer(0)))
    };
}

/**
 * `responder` posts the current snapshot and the peers advance two finalized
 * blocks past it; returns the anchor and `responder`'s payload for the tip.
 */
export async function postAnchorAndServePayload(
    h: MathPeerTestHarness,
    responder: TestPeer<HarnessControlRpc, MathStateMachine>,
    waitForPeers?: number[]
) {
    const forkId = h.activeForkId!;
    expect(
        await h.transition.postSnapshotWait({
            peerIndex: responder.index,
            forkId: String(forkId)
        })
    ).to.not.equal(undefined);
    await h.transition.advanceState({
        count: 2,
        waitForPeers,
        waitForFinalization: true
    });
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
    return applyPinnedSyncPayload(
        h,
        requester,
        responder,
        forkId,
        latestHeight,
        payload
    );
}

/** `requester` applies `payload` as `responder`'s answer to a pinned request; returns the verdict and recorded rejection reasons. */
export async function applyPinnedSyncPayload(
    h: MathPeerTestHarness,
    requester: TestPeer<HarnessControlRpc, MathStateMachine>,
    responder: TestPeer<HarnessControlRpc, MathStateMachine>,
    forkId: ForkId,
    blockHeight: number,
    payload: SyncPayload
): Promise<{ accepted: boolean; rejections: string[] }> {
    const stub = h.control(requester).stub;
    await stub.recordSyncRejections().request();
    try {
        const accepted = await h
            .control(requester)
            .spectate.applySyncResponse(
                responder.address,
                forkId,
                blockHeight,
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
