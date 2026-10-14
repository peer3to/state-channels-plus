// @spec-test-coverage-ignore: shared staging for the closed-channel exit post cases; it holds no executable evidence
import { Status } from "@/types";
import type { Hash } from "@/types/types";
import {
    chainNonceReader,
    recordLeaveChannelLogs,
    recordSnapshotPostWaitResults
} from "@test/fixtures/BotConnectionFixesStaging";
import type { SnapshotPostHoldPoint } from "@test/fixtures/customRpc/harnessControl/services/stub/StubService";
import type { MathPeerTestHarness } from "@test/fixtures/MathPeerTestHarness";
import { chainSnapshot } from "@test/fixtures/MilestoneSyncStaging";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { ethers } from "ethers";

/** The leave service's log line for an expected chain refusal of an exit post. */
const EXIT_POST_REFUSED = "The chain refused the exit snapshot post";

/**
 * Three founders open the channel and one of them leaves; its exit lands on
 * chain, so the chain's outbound head is that exit's message block. A
 * spectator then syncs and joins while the two remaining founders author: it
 * syncs from that on-chain snapshot, so it never stores that outbound block.
 * Returns the remaining founders, the seated joiner and the outbound block
 * hash the joiner lacks.
 */
export async function stageLateJoinerMissingPostedExitBlock(
    h: MathPeerTestHarness
) {
    await h.lifecycle.start(3, 0);
    const leftIndex = await h.transition.participantLeaveWait();
    const founders = [0, 1, 2].filter((index) => index !== leftIndex);
    const postedExitBlockHash = (await chainSnapshot(h)).snapshotData
        .latestOutboundMessageBlockHash as Hash;
    expect(
        postedExitBlockHash,
        "premise: the landed exit put an outbound block on chain"
    ).to.not.equal(ethers.ZeroHash);

    const { peer } = await h.join.addSpectatorAuthoring({
        authoringPeerIndices: founders,
        minimumBlocks: 2,
        maximumBlocks: 20
    });
    const joiner = h.getPeer(peer.index);
    await h.assert.sync.peersInSyncWait({
        peerIndices: [...founders, joiner.index]
    });

    // The join and its inclusion overlap the founders' authoring; handlers
    // are attached at once, so the join promise is never unobserved.
    const join: { failure?: { error: unknown } } = {};
    const joining = h.join.joinChannelWait({ joiner }).then(
        () => undefined,
        (error: unknown) => {
            join.failure = { error };
        }
    );
    await h.transition.keepAuthoringUntil({
        until: async () => {
            if (join.failure) throw join.failure.error;
            return (
                (await h.control(joiner).query.getStatus().request()) ===
                Status.PARTICIPATING
            );
        },
        waitForPeers: founders,
        maximumBlocks: 20
    });
    await joining;
    if (join.failure) throw join.failure.error;

    expect(
        await h.execOnHost(
            joiner,
            (sm, args) =>
                sm.storage.outboundMessages.getMessageBlock(args.hash) ===
                undefined,
            { hash: postedExitBlockHash }
        ),
        "premise: the joiner does not store the exit block posted before its sync"
    ).to.equal(true);
    return { founders, joiner, postedExitBlockHash };
}

/**
 * Three founders. The next writer exits first; its exit post is prepared
 * against the open fork and parks in flight at `at` (`send`: before its gas
 * estimate; `broadcast`: after its estimate passed). The other two founders
 * then exit; their posts land every exit and the zero-participant snapshot
 * closes the channel, which deletes the chain snapshot. The parked post is
 * still unreleased. Records the in-flight leaver's post outcomes, its leave
 * logs and its host errors. The caller releases the post with `releasePost`
 * and calls `restore` in `finally`.
 */
export async function stageExitPostInFlightAcrossClose(
    h: MathPeerTestHarness,
    at: SnapshotPostHoldPoint
) {
    await h.lifecycle.start(3, 0);
    const leaver = h.getPeer((await h.query.getNextPeerToWrite()).index);
    const members = h.peers.map((peer) => peer.index);
    const hostErrors: string[] = [];
    const removeHostErrorListener = leaver.p2pInstance.onHostError((error) =>
        hostErrors.push(error.message)
    );
    const posts = await recordSnapshotPostWaitResults(h, leaver);
    const logs = await recordLeaveChannelLogs(h, leaver);
    const send = await h.rpcStub.holdSnapshotPostSend(leaver.index, { at });
    const readNonce = await chainNonceReader(h, leaver);
    const restore = async () => {
        removeHostErrorListener();
        await send.release();
        await logs.restore();
        await posts.restore();
    };
    try {
        await h.transition.participantLeaveStateTransition({
            leaverIndex: leaver.index
        });
        await send.waitUntilHeld();
        expect(
            await h.channelManager.getParticipants(h.channelId),
            "premise: the in-flight post has not landed the exit"
        ).to.include(leaver.address);
        expect(
            await posts.results(),
            "premise: the in-flight post has not settled"
        ).to.deep.equal([]);
        const nonceBeforeRelease = await readNonce();

        await h.transition.participantLeaveStateTransition();
        await h.transition.participantLeaveStateTransition();
        await waitFor(
            async () => !(await h.channelManager.isChannelOpen(h.channelId))[0],
            h.event.protocolEventTimeoutMs()
        );
        expect(
            (await chainSnapshot(h)).forkID,
            "premise: the close deleted the chain snapshot"
        ).to.equal(ethers.ZeroHash);

        return {
            leaver,
            members,
            nonceBeforeRelease,
            readNonce,
            /** Releases the parked post; its raw send outcome (see `holdSnapshotPostSend`). */
            releasePost: send.release,
            /**
             * After the release: the leave's exit post was refused with
             * `refusal`, logged once as a chain refusal, and any later post
             * sent nothing; every member left once, the leaver ends
             * NOT_OPENED and its runtime raised no host error.
             */
            assertRefusedAndLeft: async (refusal: string) => {
                const results = await posts.resultsWait(1);
                expect(results).to.deep.equal([
                    refusal,
                    ...results.slice(1).map(() => "no-op")
                ]);
                await waitFor(
                    async () =>
                        (await logs.entries()).some(
                            (entry) => entry.message === EXIT_POST_REFUSED
                        ),
                    h.event.protocolEventTimeoutMs()
                );
                expect(
                    (await logs.entries()).filter(
                        (entry) => entry.message === EXIT_POST_REFUSED
                    )
                ).to.deep.equal([
                    { message: EXIT_POST_REFUSED, meta: [{ refusal }] }
                ]);
                for (const index of members)
                    await h.event.waitUntilLeftChannel(index);
                expect(
                    h.event.getEventCallCount(leaver.index, "onLeftChannel")
                ).to.equal(1);
                expect(
                    await h.control(leaver).query.getStatus().request()
                ).to.equal(Status.NOT_OPENED);
                expect(hostErrors).to.deep.equal([]);
            },
            restore
        };
    } catch (error) {
        await restore();
        throw error;
    }
}
