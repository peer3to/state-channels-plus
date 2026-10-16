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

/**
 * Each of the joiner's first `count` held join submissions meets a snapshot
 * move to a stored one before it runs, so each is refused on its stale pin.
 * Later submissions stay held.
 */
export async function refuseHeldJoinsOnSnapshotMoves(
    h: MathPeerTestHarness,
    joinerIndex: number,
    count: number
): Promise<void> {
    for (let held = 1; held <= count; held++) {
        await waitForHeldJoins(h, joinerIndex, held);
        await moveChainSnapshot(h);
        await h.rpcStub.releaseOneMembershipSubmission(joinerIndex);
    }
}

/**
 * A synced spectator's connect join is held at its send while two more
 * synced spectators join one after another: the first lands while the
 * joiner's first submission is held, which is then released and refused for
 * the threshold set the first widened; the second lands while the joiner's
 * second submission is held. Returns then, with that submission still held
 * (later ones stay held), the countersignature requests the first joiner
 * answered for the joiner's second collection, and reads of the requests
 * the two landed joiners answer from then on.
 */
export async function raceJoinPastTwoLandingJoins(
    h: MathPeerTestHarness,
    options: {
        maxChannelParticipants?: number;
        shouldSpectateWhenFull?: boolean;
    } = {}
) {
    const joiner = await h.scenario.syncSpectator(4, {
        maxChannelParticipants: options.maxChannelParticipants
    });
    const addSpectator = async () =>
        (
            await h.join.addSpectatorAuthoring({
                authoringPeerIndices: [0, 1, 2],
                minimumBlocks: 0,
                maximumBlocks: 16
            })
        ).peer;
    const first = await addSpectator();
    const second = await addSpectator();
    await h.assert.sync.peersInSyncWait();
    const releaseJoiner = await h.rpcStub.holdMembershipSubmission(
        joiner.index,
        "joinChannel"
    );
    const join = joiner.p2pInstance.p2pSigner.connectToChannel(h.channelId!, {
        shouldJoin: true,
        shouldSpectateWhenFull: options.shouldSpectateWhenFull
    });
    // observed by the caller; keeps a failure from being an unhandled rejection meanwhile
    join.catch(() => undefined);
    // the first confirmation is collected against the founders alone
    await waitForHeldJoins(h, joiner.index, 1);

    const isFirstJoined = await first.p2pInstance.p2pSigner.connectToChannel(
        h.channelId!,
        { shouldJoin: true }
    );
    const secondRoundByFirst = await countJoinSignatureRequests(h, [
        first.index
    ]);
    await h.rpcStub.releaseOneMembershipSubmission(joiner.index);
    await waitForHeldJoins(h, joiner.index, 2);
    const secondRound = { byFirst: await secondRoundByFirst() };

    const isSecondJoined = await second.p2pInstance.p2pSigner.connectToChannel(
        h.channelId!,
        { shouldJoin: true }
    );
    // counted from here: the second's own collection asked the first too
    const countersignedByFirst = await countJoinSignatureRequests(h, [
        first.index
    ]);
    const countersignedBySecond = await countJoinSignatureRequests(h, [
        second.index
    ]);
    return {
        joiner,
        first,
        second,
        isFirstJoined,
        isSecondJoined,
        join,
        releaseJoiner,
        secondRound,
        countersignedByFirst,
        countersignedBySecond
    };
}

/**
 * A synced spectator connects with a join to a channel already at its
 * maximum participant count: the three founders alone, or with
 * `isFilledByPendingJoin` the founders and a second spectator whose join
 * landed pending before the connect. Returns the connect's result, the
 * on-chain seated and pending participants just before the connect, the
 * countersignature requests the threshold set answered for it, and the
 * joiner's JOIN amounts on chain since the connect.
 */
export async function joinFullChannel(
    h: MathPeerTestHarness,
    options: {
        shouldSpectateWhenFull?: boolean;
        isFilledByPendingJoin?: boolean;
    } = {}
) {
    const joiner = await h.scenario.syncSpectator(4, {
        maxChannelParticipants: options.isFilledByPendingJoin ? 4 : 3
    });
    const pendingJoiner = options.isFilledByPendingJoin
        ? await landPendingJoin(h)
        : undefined;
    const countersigned = await countJoinSignatureRequests(
        h,
        await remoteThresholdPeerIndices(h, joiner.index)
    );
    const fromBlock =
        await joiner.p2pInstance.chainSigner.provider!.getBlockNumber();
    const [participantsAtConnect, pendingAtConnect] = await Promise.all([
        h.channelManager.getParticipants(h.channelId),
        h.channelManager.getPendingParticipants(h.channelId)
    ]);
    const isJoined = await joiner.p2pInstance.p2pSigner.connectToChannel(
        h.channelId!,
        {
            shouldJoin: true,
            shouldSpectateWhenFull: options.shouldSpectateWhenFull
        }
    );
    return {
        joiner,
        pendingJoiner,
        participantsAtConnect,
        pendingAtConnect,
        isJoined,
        countersignatures: await countersigned(),
        joinAmounts: await chainJoinAmounts(h, joiner.address, fromBlock)
    };
}

/** A new spectator syncs and its join lands pending; returns that peer. */
export async function landPendingJoin(h: MathPeerTestHarness) {
    const { peer } = await h.join.addSpectatorAuthoring({
        authoringPeerIndices: [0, 1, 2],
        minimumBlocks: 0,
        maximumBlocks: 16
    });
    await h.assert.sync.peersInSyncWait();
    const isJoined = await peer.p2pInstance.p2pSigner.connectToChannel(
        h.channelId!,
        { shouldJoin: true }
    );
    if (!isJoined) throw new Error("the spectator's join did not land");
    return peer;
}
