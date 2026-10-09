// @spec-test-coverage-ignore: sync replay-base staging exercised by explicit unit declarations
import type { MathPeerTestHarness } from "@test/fixtures/MathPeerTestHarness";
import {
    latestHeight,
    nextWriters,
    waitForMutualConnection
} from "@test/fixtures/MilestoneSyncStaging";

/**
 * Three participants and a synced spectator. The spectator is cut off, the
 * participants author `finalBlocksWhileCutOff` final blocks, then two blocks
 * the third writer neither sees nor signs (an unfinalized tail). The spectator
 * is reconnected to the first tail writer, the responder. Its latest height
 * is the served proof's final point (0 final blocks while cut off) or one
 * below it (1 final block). `inline` runs the runtimes in this process, so
 * a caller can drive the spectator's state manager directly.
 */
export async function stageSpectatorBehindUnfinalizedTail(
    h: MathPeerTestHarness,
    options: { finalBlocksWhileCutOff: 0 | 1; inline?: boolean }
) {
    // a slow calldata fallback keeps the silent writer's missing
    // confirmations from being posted inside the test
    await h.lifecycle.start(3, 0, {
        timeConfig: { chainFallbackTime: 60 },
        configOverrides: options.inline
            ? { RUN_SDK_IN_THREAD: false }
            : undefined
    });
    const participants = [0, 1, 2];
    // Create and sync the spectator before block 0 so startup cannot spend
    // the next author's timestamp window.
    const spectator = h.getPeer((await h.join.addSpectatorWait()).index);
    await h.transition.advanceState({
        count: 2,
        waitForPeers: participants,
        waitForFinalization: true
    });
    await h.assert.sync.peersInSyncWait({
        peerIndices: [...participants, spectator.index]
    });
    const forkId = h.activeForkId!;

    await h.network.blacklistAndDisconnectPeer(spectator.index);
    if (options.finalBlocksWhileCutOff > 0)
        await h.transition.advanceState({
            count: options.finalBlocksWhileCutOff,
            waitForPeers: participants,
            waitForFinalization: true
        });
    const [first, second, silent] = await nextWriters(h, 0, 3);
    for (const index of participants)
        await h.rpcStub.suppressTimeoutCheck(index);
    await h.rpcStub.dropNetworkConfirmations(silent);
    await h.byzantine.stubCalldataHandler(silent);
    await h.transition.advanceState({
        count: 2,
        waitForPeers: [first, second],
        waitForFinalization: false
    });
    const responder = h.getPeer(first);
    const tip = await latestHeight(h, responder, forkId);

    await h.network.reconnectPeers([spectator.index]);
    await waitForMutualConnection(h, spectator, responder);
    return { forkId, spectator, responder, tip };
}
