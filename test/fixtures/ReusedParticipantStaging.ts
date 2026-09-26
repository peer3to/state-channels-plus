// @spec-test-coverage-ignore: shared staging for the committed-participant reuse E2E declaration
import type { HarnessControlRpc } from "./customRpc/harnessControl/HarnessControlRpc";
import type { PeerTestHarness } from "./PeerTestHarness";
import { TargetedChannelJoinFixture } from "./TargetedChannelJoinFixture";
import { Status } from "@/types";
import { addressesEqual } from "@/utils";
import type { TestPeer } from "@test/harness/core/types";
import { waitFor } from "@test/utils/waitFor";
import type { MathStateMachine } from "@typechain-types";
import { expect } from "chai";
import { ethers } from "ethers";

/**
 * A committed participant leaves through its authored exit, and the same
 * runtime opens a second channel with a fresh partner as a participant. Both
 * channels then produce blocks: the reused runtime authors and signs in the
 * new one, stores nothing of the old one, and holds no verdict against the
 * old channel's peers.
 */
export async function assertLeftParticipantParticipatesInNextChannel() {
    const { h, channelId, targeted } =
        await TargetedChannelJoinFixture.unopened(
            "reuse-committed-participant",
            3
        );
    await h.lifecycle.openChannelForParticipants([0, 1, 2]);
    await h.network.joinSelectedKey([0, 1, 2], channelId);
    const oldForkId = h.activeForkId!;
    const leaver = h.getPeer(1);
    await h.lifecycle.leaveWithAuthoredExit(leaver.index);

    const partner = await targeted.addFreshPeer();
    const nextChannelId = ethers.id("reuse-committed-participant-next");
    expect(
        await Promise.all(
            [leaver, partner].map((peer) =>
                targeted.connect(peer, nextChannelId, { autoOpen: true })
            )
        )
    ).to.deep.equal([true, true]);
    const nextForkId = await h.control(leaver).query.getForkId().request();

    // The old channel keeps going without the leaver.
    await h.transition.advanceState({
        count: 2,
        waitForPeers: [0, 2],
        waitForFinalization: false
    });

    // Two blocks in the new channel, each authored by whichever of the pair
    // holds the turn and signed by both.
    const pair = [leaver, partner];
    const startHeight = await tipHeight(h, leaver, nextForkId);
    for (let block = 0; block < 2; block++) {
        const nextToWrite = await h
            .control(leaver)
            .query.getNextToWrite()
            .request();
        const writer = pair.find((peer) =>
            addressesEqual(peer.address, nextToWrite)
        ) as TestPeer<HarnessControlRpc, MathStateMachine>;
        const before = await tipHeight(h, leaver, nextForkId);
        await writer.p2pInstance.p2pContractInstance.add(1);
        await waitFor(async () => {
            for (const peer of pair) {
                const tip = await h
                    .control(peer)
                    .query.getSyncTip(nextForkId)
                    .request();
                if (!tip || tip.height <= before || !tip.finalized)
                    return false;
            }
            return true;
        }, h.event.protocolEventTimeoutMs());
    }

    const tip = await h.control(leaver).query.getSyncTip(nextForkId).request();
    expect({
        status: Status[await h.control(leaver).query.getStatus().request()],
        channelId: await h.control(leaver).query.getChannelId().request(),
        newChannelTip: tip && {
            grewByTwo: tip.height === startHeight + 2,
            finalized: tip.finalized,
            signedByBoth: tip.signatures === tip.union && tip.union === 2
        },
        oldForkStored: await h
            .control(leaver)
            .query.getLatestBlockHeight(oldForkId)
            .request(),
        blacklisted: await Promise.all(
            [h.getPeer(0), h.getPeer(2)].map((peer) =>
                h.control(leaver).query.isBlacklisted(peer.address).request()
            )
        ),
        inOldChannel: (await h.channelManager.getParticipants(channelId)).some(
            (address: string) => addressesEqual(address, leaver.address)
        )
    }).to.deep.equal({
        status: Status[Status.PARTICIPATING],
        channelId: nextChannelId,
        newChannelTip: { grewByTwo: true, finalized: true, signedByBoth: true },
        oldForkStored: null,
        blacklisted: [false, false],
        inOldChannel: false
    });
}

async function tipHeight(
    h: PeerTestHarness,
    peer: TestPeer,
    forkId: string
): Promise<number> {
    return (
        (await h.control(peer).query.getSyncTip(forkId).request())?.height ?? -1
    );
}
