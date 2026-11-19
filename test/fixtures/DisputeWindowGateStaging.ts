// @spec-test-coverage-ignore: dispute-window gate staging shared by the mapped dispute-window tests
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import type { ForkId } from "@/types/types";
import { waitFor } from "@test/utils/waitFor";

/**
 * Settle a disputed fork and clear its window: wait until the honest peers
 * reduced onto another fork and the chain adopted it; an inbound message then
 * moves the chain's inbound head, and their same-fork snapshot update clears
 * the disputed fork's window and prunes the inbound blocks its disputes name.
 */
export async function clearSettledDisputeWindow(
    h: MathPeerTestHarness,
    forkId: ForkId,
    honestIndices: number[]
): Promise<void> {
    const forkOf = (index: number) =>
        h.execOnHost(
            h.getPeer(index),
            (sm) => String(sm.forkId),
            {},
            {
                timeoutMs: h.event.hostExecTimeoutMs()
            }
        );
    await waitFor(async () => {
        const forks = await Promise.all(honestIndices.map(forkOf));
        return forks.every((fork) => fork !== String(forkId));
    }, h.event.protocolEventTimeoutMs() * 2);
    const reducedForkId = await forkOf(honestIndices[0]);
    // the chain refuses an inbound message while the fork is disputed: wait
    // for the adoption post of the reduced fork
    await waitFor(
        async () =>
            String(
                (await h.channelManager.getStateSnapshot(h.channelId)).forkId
            ) === reducedForkId
    );

    await h.join.forceInboundJoinWait({
        participant: h.getPeer(honestIndices[0]).address
    });
    await postWindowClearingSnapshot(h, forkId, reducedForkId, honestIndices);
}

/**
 * The honest peers finalize a block on `reducedForkId` and post its
 * snapshot. The chain clears its storage on that update, as the fork has no
 * window: the disputed fork's window is gone.
 */
export async function postWindowClearingSnapshot(
    h: MathPeerTestHarness,
    forkId: ForkId,
    reducedForkId: string,
    honestIndices: number[]
): Promise<void> {
    await h.transition.fromHonestPeersOnly((contract) => contract.add(1), {
        waitForFinalization: true
    });
    await h.transition.postSnapshot({
        peerIndex: honestIndices[0],
        forkId: reducedForkId
    });
    await waitFor(
        async () =>
            !(await h.query.killPeriod(forkId, honestIndices[0])).windowExists
    );
}

/**
 * A double signer paused through a threshold-final dispute, as a background
 * browser tab: four peers, its contract logs are held and its timeout check
 * and own disputes are suppressed, so it takes no part in the window. The
 * others post the final dispute and install its output fork without it. A
 * final dispute has no adoption post, so the chain refuses an inbound
 * message until a snapshot of the output fork lands: their first snapshot
 * post clears the disputed fork's window. Its block 0 must come at once, or
 * the output fork's height-0 timeout disputes it. Returns with the logs still held and a
 * record-only count of its `completeWithGenesis` calls.
 */
export async function stageFinalDisputeWhileAway(h: MathPeerTestHarness) {
    await h.scenario.preDisputeSetup({
        peerCount: 4,
        timeConfig: { evidenceTime: 3 }
    });
    const forkId = h.activeForkId!;
    const pausedIndex = 1;
    await h.rpcStub.suppressTimeoutCheck(pausedIndex);
    await h.dispute.suppressDisputeInitiation([pausedIndex]);
    const releaseLogs = await h.rpcStub.holdContractLogs(pausedIndex);
    const genesisInstalls =
        await h.rpcStub.countCompleteWithGenesis(pausedIndex);
    const staged = await h.dispute.submitFinalDispute({
        maliciousPeerIndex: pausedIndex
    });
    // a paused tab also loses its peer connections: it never syncs the
    // output fork from the others' blocks
    await h.network.blacklistAndDisconnectPeer(pausedIndex);
    await h.dispute.resolveFinalDispute(staged);
    const honestIndices = h.getActiveHonestPeers().map((peer) => peer.index);
    await postWindowClearingSnapshot(
        h,
        forkId,
        String(staged.finalResolution.forkId),
        honestIndices
    );
    return { pausedIndex, releaseLogs, genesisInstalls };
}

/**
 * A synced spectator paused through a whole dispute cycle: three
 * participants and a spectator whose contract logs are held and whose peer
 * connections are cut, so it stays on the disputed fork. A participant
 * authors an invalid block; the others dispute it, reduce the fork without
 * it and clear the disputed fork's window. Returns with the logs still held.
 */
export async function stageSpectatorAwayThroughDispute(h: MathPeerTestHarness) {
    await h.lifecycle.start(3, 1);
    const participants = h.peers.map((peer) => peer.index);
    // no transition is scheduled while the spectator syncs
    const spectatorIndex = (await h.join.addSpectatorWait()).index;
    await h.assert.sync.peersInSyncWait({
        peerIndices: [...participants, spectatorIndex]
    });
    const forkId = h.activeForkId!;
    const offenderIndex = (await h.query.getNextPeerToWrite()).index;
    const honestIndices = participants.filter(
        (index) => index !== offenderIndex
    );
    const releaseLogs = await h.rpcStub.holdContractLogs(spectatorIndex);
    // without its connections it never syncs the reduced fork from the
    // participants' blocks, and it stays out of the honest-peer waits
    await h.network.blacklistAndDisconnectPeer(spectatorIndex);
    h.contextApi.markAfkPeer({ afkPeerIndex: spectatorIndex });

    await h.byzantine.submitInvalidStateTransitionBlock(offenderIndex);
    await clearSettledDisputeWindow(h, forkId, honestIndices);
    return { forkId, spectatorIndex, releaseLogs };
}
