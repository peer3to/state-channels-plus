// @spec-test-coverage-ignore: shared staging for exits of every participant that a JOIN landing after the last exit block blocks
import { StateSnapshot } from "@/models";
import { Codec, Type } from "@/utils";
import {
    exitOnLeaveTurn,
    recordSnapshotPostWaitResults
} from "@test/fixtures/BotConnectionFixesStaging";
import type { MathPeerTestHarness } from "@test/fixtures/MathPeerTestHarness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

type HarnessPeer = ReturnType<MathPeerTestHarness["getPeer"]>;

/** Sum of the balances in the peer's installed state. */
export async function readTotalStateBalance(
    h: MathPeerTestHarness,
    peer: HarnessPeer
): Promise<bigint> {
    return BigInt(
        await h.execOnHost(peer, async (sm) =>
            String((await sm.diamondStateMachine.getTotalStateBalance()).amount)
        )
    );
}

/**
 * Two founders open the channel and a spectator syncs. Both founders leave
 * and send their exits on their leave turns, so the last exit block leaves
 * no participant. Their exit posts park before they prepare: the chain
 * still lists both founders and the channel stays open. The spectator's
 * JOIN then lands on chain and the parked posts run. No member is left to
 * author a block that consumes the JOIN, so the chain refuses each post.
 * Returns once each founder's first post was refused. Both leave watchdogs
 * are held; `expireWatchdogs` runs them as their expiry does. The joiner's
 * force-join dispute is suppressed, so the founders' self-removal disputes
 * start the dispute. `restore` removes the post recorders.
 */
export async function stageEveryExitBlockedByLateJoin(h: MathPeerTestHarness) {
    await h.lifecycle.start(2, 0);
    const forkId = h.activeForkId!;
    const founders = [h.getPeer(0), h.getPeer(1)];
    const { peer } = await h.join.addSpectatorAuthoring({
        authoringPeerIndices: [0, 1],
        minimumBlocks: 2,
        maximumBlocks: 20
    });
    const joiner = h.getPeer(peer.index);
    await h.assert.sync.peersInSyncWait({
        peerIndices: [0, 1, joiner.index]
    });
    // the leavers' disputes are the subject, not the joiner's
    await h.control(joiner).stub.stubSuppressForceJoinDispute().request();

    const foundersBalance = await readTotalStateBalance(h, founders[0]);
    const channelBalanceBefore = await h.channelManager.getChannelBalance(
        h.channelId
    );
    const disputes = await Promise.all(
        founders.map((founder) =>
            h.rpcStub.recordDisputeSubmissions(founder.index, {
                forward: true
            })
        )
    );
    const watchdogs = await Promise.all(
        founders.map((founder) =>
            h.rpcStub.holdScheduledTasks(
                founder.index,
                "channel leave watchdog"
            )
        )
    );
    const posts = await Promise.all(
        founders.map((founder) => recordSnapshotPostWaitResults(h, founder))
    );
    const restore = async () => {
        for (const recorder of posts) await recorder.restore();
    };
    try {
        for (const recorder of posts) await recorder.holdStarts();
        const exits = founders.map((founder) => exitOnLeaveTurn(founder));
        for (const founder of founders)
            await founder.p2pInstance.p2pSigner.leaveChannel();
        // one block hands the turn to the leavers; each sends its exit on
        // its leave turn
        await h.transition.advanceState({ waitForPeers: [0, 1] });
        await h.event.waitForPeers("onLeaveTurn", [0, 1], 1);
        for (const exit of exits) await exit();
        for (const founder of founders)
            await h.event.waitUntilLeaveState(
                founder.index,
                "isExitBlockCommitted"
            );
        // every exit block is finalized off-chain and the spectator holds
        // them too; each founder's exit post is parked before it prepares
        await h.assert.sync.peersInSyncWait({
            peerIndices: [0, 1, joiner.index]
        });
        for (const founder of founders)
            expect(
                await h.control(founder).query.getParticipants().request(),
                "premise: the last exit block leaves no participant"
            ).to.deep.equal([]);
        await waitFor(async () => {
            for (const recorder of posts)
                if ((await recorder.started()) === 0) return false;
            return true;
        }, h.event.protocolEventTimeoutMs());

        // the JOIN lands while the chain still lists both founders
        const prepared = await h.join.buildJoinChannelConfirmation({
            joiner,
            channelId: h.channelId
        });
        const deposit = BigInt(
            Codec.decode(
                String(
                    prepared.confirmation.signedJoinChannel.encodedJoinChannel
                ),
                Type.JoinChannel
            ).balance.amount
        );
        expect(
            await joiner.p2pInstance.p2pSigner.joinChannel(
                prepared.confirmation,
                prepared.expectedSnapshotHash,
                prepared.expectedForkId
            )
        ).to.equal(true);

        // the parked posts run and the unconsumed JOIN refuses them
        for (const recorder of posts) await recorder.releaseStarts();
        for (const recorder of posts)
            expect((await recorder.resultsWait(1))[0]).to.equal(
                "RaceConditionPendingInboundNotConsumed"
            );
        expect(
            StateSnapshot.from(
                await h.channelManager.getStateSnapshot(h.channelId)
            ).forkID,
            "premise: no exit snapshot was posted"
        ).to.equal(forkId);
        expect(
            await h.channelManager.getParticipants(h.channelId)
        ).to.have.members(founders.map((founder) => founder.address));
        expect(
            await h.channelManager.getPendingParticipants(h.channelId)
        ).to.deep.equal([joiner.address]);

        return {
            forkId,
            founders,
            joiner,
            deposit,
            foundersBalance,
            depositsBefore: BigInt(channelBalanceBefore.totalDeposits.amount),
            withdrawalsBefore: BigInt(
                channelBalanceBefore.totalWithdrawals.amount
            ),
            disputes,
            restore,
            /** Runs each founder's held leave watchdog, as its expiry does. */
            expireWatchdogs: async () => {
                for (const watchdog of watchdogs) {
                    expect(await watchdog.heldCount()).to.equal(1);
                    await watchdog.release(true);
                }
            }
        };
    } catch (error) {
        await restore();
        throw error;
    }
}
