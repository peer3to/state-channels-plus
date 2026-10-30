import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

const DISPUTE_EVENTS = ["DisputeCommitted", "DisputeCommittedWithAuditingData"];

/**
 * A peer paused through a whole dispute cycle, as a background browser tab:
 * the next writer never authors and its contract logs are held. The other
 * peers time it out and reduce the fork without it; an inbound message moves
 * the chain's inbound head, and their same-fork snapshot update clears the
 * disputed fork's window and prunes the inbound blocks the timeout disputes
 * name. The held logs are then started in chain order, the dispute events
 * first, as the resumed runtime meets them after the chain moved on. While
 * the peer still participates on the disputed fork, the disputes must be
 * ignored: auditing them against the pruned chain, killing them and building
 * a state proof of the settled fork used to fail the event pipeline. Then the
 * snapshot update it never installed removed it, so it leaves the channel.
 */
describe("Dispute window cleared before handling", function () {
    it("a timed-out peer whose chain events were held through the disputes, the reduction and a same-fork snapshot update ignores the disputes and leaves", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.timeoutSetup(3, 2);
        const forkId = h.activeForkId!;
        const pausedIndex = (await h.query.getNextPeerToWrite()).index;
        const releaseLogs = await h.rpcStub.holdContractLogs(pausedIndex);
        // a paused tab also loses its peer connections: without this it
        // syncs the reduced fork from the others' blocks and never meets the
        // missed events as stale
        await h.network.blacklistAndDisconnectPeer(pausedIndex);
        h.contextApi.markMaliciousPeer({ maliciousPeerIndex: pausedIndex });
        const honestIndices = h.peers
            .map((peer) => peer.index)
            .filter((index) => index !== pausedIndex);
        const forkOf = (index: number) =>
            h.execOnHost(
                h.getPeer(index),
                (sm) => String(sm.forkId),
                {},
                {
                    timeoutMs: h.event.hostExecTimeoutMs()
                }
            );

        // the timeout disputes, then the reduction onto a fork without it
        await waitFor(
            async () =>
                (await h.query.killPeriod(forkId, honestIndices[0]))
                    .windowExists
        );
        await waitFor(async () => {
            const forks = await Promise.all(honestIndices.map(forkOf));
            return forks.every((fork) => fork !== String(forkId));
        }, h.event.protocolEventTimeoutMs() * 2);
        const reducedForkId = await forkOf(honestIndices[0]);
        // the chain refuses an inbound message while the fork is disputed:
        // wait for the adoption post of the reduced fork
        await waitFor(
            async () =>
                String(
                    (await h.channelManager.getStateSnapshot(h.channelId))
                        .forkId
                ) === reducedForkId
        );

        await h.join.forceInboundJoinWait({
            participant: h.getPeer(honestIndices[0]).address
        });
        await h.transition.fromHonestPeersOnly((contract) => contract.add(1), {
            waitForFinalization: true
        });
        await h.transition.postSnapshot({
            peerIndex: honestIndices[0],
            forkId: reducedForkId
        });
        await waitFor(
            async () =>
                !(await h.query.killPeriod(forkId, honestIndices[0]))
                    .windowExists
        );

        const failures = [
            ...(await releaseLogs(DISPUTE_EVENTS)),
            ...(await releaseLogs())
        ];
        expect(failures).to.deep.equal([]);
        await h.event.waitUntilLeftChannel(pausedIndex);
        // a settled dispute is not shown to the app as a live one
        for (const hook of ["disputeStarted", "onDisputeUpdate"] as const)
            expect(
                h.event.getEventCallCount(pausedIndex, hook),
                `the paused peer reported a settled dispute (${hook})`
            ).to.equal(0);
    });
});
