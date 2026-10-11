// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import StateSnapshot from "@/models/StateSnapshot";
import { Codec, Type } from "@/utils";
import type { MathPeerTestHarness } from "@test/fixtures/MathPeerTestHarness";
import { waitFor } from "@test/utils/waitFor";
import { id } from "ethers";

/**
 * The participants finalize one more block and post its snapshot; returns the
 * new on-chain snapshot hash. By default every honest peer has stored the new
 * snapshot when this returns; with `isChainOnly` it waits for the chain alone,
 * for a peer that is not to store it.
 */
export async function moveChainSnapshot(
    h: MathPeerTestHarness,
    options: { isChainOnly?: boolean } = {}
): Promise<string> {
    const readChainHash = async () =>
        String(
            StateSnapshot.from(
                await h.channelManager.getStateSnapshot(h.channelId)
            ).hash
        );
    const before = await readChainHash();
    await h.transition.advanceState({
        count: 1,
        waitForPeers: [0, 1, 2],
        waitForFinalization: true
    });
    if (options.isChainOnly) {
        await h.transition.postSnapshot();
        await waitFor(
            async () => (await readChainHash()) !== before,
            h.event.protocolEventTimeoutMs({ withFirstBlockGrace: true })
        );
    } else {
        await h.transition.postSnapshotWait();
    }
    const after = await readChainHash();
    if (after === before)
        throw new Error("the snapshot post did not move the chain snapshot");
    return after;
}

/** Waits until `count` of the peer's join submissions entered its submission hold. */
export async function waitForHeldJoins(
    h: MathPeerTestHarness,
    peerIndex: number,
    count: number
): Promise<void> {
    await waitFor(
        async () =>
            (await h
                .control(h.getPeer(peerIndex))
                .stub.getHeldMembershipReceiptCount()
                .request()) === count,
        h.event.protocolEventTimeoutMs()
    );
}

/**
 * Counts the join countersignature requests the given peers answer from now
 * on (the real handler still runs); returns a read of the running total.
 */
export async function countJoinSignatureRequests(
    h: MathPeerTestHarness,
    peerIndices: number[]
): Promise<() => Promise<number>> {
    for (const peerIndex of peerIndices) {
        await h
            .control(h.getPeer(peerIndex))
            .stub.stubCountJoinSignatureRequests()
            .request();
    }
    return async () => {
        let total = 0;
        for (const peerIndex of peerIndices) {
            total += await h
                .control(h.getPeer(peerIndex))
                .stub.getJoinSignatureRequestCount()
                .request();
        }
        return total;
    };
}

/** The peers other than `requester` whose countersignature a confirmation needs: the on-chain threshold set. */
export async function remoteThresholdPeerIndices(
    h: MathPeerTestHarness,
    requesterIndex: number
): Promise<number[]> {
    const thresholdSet = (
        await h.channelManager.getOnChainThresholdSet(h.channelId)
    ).map(String);
    return h.peers
        .filter(
            (peer) =>
                peer.index !== requesterIndex &&
                thresholdSet.includes(peer.address)
        )
        .map((peer) => peer.index);
}

/**
 * One threshold member other than `requesterIndex` refuses every join
 * countersignature request from now on, so a confirmation collected for
 * the requester fails.
 */
export async function refuseOneThresholdCountersignature(
    h: MathPeerTestHarness,
    requesterIndex: number
): Promise<void> {
    const [refuserIndex] = await remoteThresholdPeerIndices(h, requesterIndex);
    await h
        .control(h.getPeer(refuserIndex))
        .stub.stubFailJoinSignatureRequests()
        .request();
}

/**
 * The balance amounts of the on-chain JOIN messages (joins and top-ups) for
 * `participant` in chain blocks from `fromBlock` on.
 */
export async function chainJoinAmounts(
    h: MathPeerTestHarness,
    participant: string,
    fromBlock: number
): Promise<bigint[]> {
    const logs = await h.channelManager.queryFilter(
        h.channelManager.filters.InboundMessagesProcessed(h.channelId),
        fromBlock
    );
    return logs.flatMap((log) =>
        Codec.decode(
            Codec.encode(log.args.messageBlock, Type.MessageBlock),
            Type.MessageBlock
        )
            .messages.filter(
                (message) => message.messageType === id("JOIN_CHANNEL_MESSAGE")
            )
            .map((message) => Codec.decode(message.data, Type.JoinChannel))
            .filter((join) => join.participant === participant)
            .map((join) => BigInt(join.balance.amount))
    );
}
