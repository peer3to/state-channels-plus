// @spec-test-coverage-ignore: paused-peer staging shared by the mapped dispute-window-cleared tests
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import { clearSettledDisputeWindow } from "@test/fixtures/DisputeWindowGateStaging";
import { waitFor } from "@test/utils/waitFor";

/**
 * A peer paused through a whole dispute cycle, as a background browser tab:
 * three peers, the next writer never authors and its contract logs are held.
 * The other peers time it out and reduce the fork without it; an inbound
 * message moves the chain's inbound head, and their same-fork snapshot update
 * clears the disputed fork's window and prunes the inbound blocks the timeout
 * disputes name. That update removes the paused peer, which never installed
 * it. Returns with the logs still held: the release starts them as the
 * resumed runtime meets them after the chain moved on.
 */
export async function stageRemovedWhileAway(h: MathPeerTestHarness) {
    await h.lifecycle.timeoutSetup(3, 2);
    const forkId = h.activeForkId!;
    const pausedIndex = (await h.query.getNextPeerToWrite()).index;
    const releaseLogs = await h.rpcStub.holdContractLogs(pausedIndex);
    // a paused tab also loses its peer connections: without this it syncs
    // the reduced fork from the others' blocks and never meets the missed
    // events as stale
    await h.network.blacklistAndDisconnectPeer(pausedIndex);
    h.contextApi.markMaliciousPeer({ maliciousPeerIndex: pausedIndex });
    const honestIndices = h.peers
        .map((peer) => peer.index)
        .filter((index) => index !== pausedIndex);
    // the timeout disputes, then the reduction onto a fork without it
    await waitFor(
        async () =>
            (await h.query.killPeriod(forkId, honestIndices[0])).windowExists
    );
    await clearSettledDisputeWindow(h, forkId, honestIndices);
    return { pausedIndex, honestIndices, releaseLogs };
}
