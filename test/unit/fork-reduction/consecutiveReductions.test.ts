import { MathTestSession as TestSession } from "@test/harness";
import { covers } from "./domain";

/**
 * Two consecutive reductions (fork A→B→C) followed by sustained honest state transitions, asserting
 * every honest survivor stays in sync the whole way through.
 */

const TIME = { evidenceTime: 10 };
const RESOLVE = {
    forkSettleTimeoutMs: 90000,
    disputesCommittedTimeoutMs: 30000
};
const WAIT = 45000;

describe("fork-reduction / consecutiveReductions", function () {
    it(
        "fork A→B→C: two reductions then sustained honest activity → all survivors stay in sync",
        covers(
            {
                baseFork: "already-reduced"
            },
            async function () {
                this.timeout(300000);
                const h = TestSession.getHarness();
                const survivors = () =>
                    h
                        .getPeersExcludingMaliciousAndLeavers()
                        .map((p) => p.index);

                // 5 peers so two reductions still leave >= 2 honest survivors
                await h.lifecycle.start(5, 2, { timeConfig: TIME });
                await h.assert.sync.peersInSyncWait();

                // reduction 1: fork A -> B
                const forkBefore1 = h.activeForkId!;
                const attacker1 = (await h.query.getNextPeerToWrite()).index;
                await h.byzantine.submitInvalidStateTransitionBlock(attacker1);
                await h.dispute.resolveDisputeWait(RESOLVE);
                await h.assert.snapshot.onChainSnapshotChangedWait({
                    previousForkId: forkBefore1,
                    timeoutMs: WAIT
                });
                await h.assert.sync.peersInSyncWait({
                    peerIndices: survivors(),
                    timeout: WAIT
                });
                await h.transition.advanceState({ waitForPeers: survivors() });
                await h.assert.sync.peersInSyncWait({
                    peerIndices: survivors(),
                    timeout: WAIT
                });

                // reduction 2: fork B -> C
                const attacker2 = (await h.query.getNextPeerToWrite()).index;
                await h.byzantine.submitInvalidStateTransitionBlock(attacker2);
                await h.dispute.resolveDisputeWait(RESOLVE);
                await h.assert.sync.peersInSyncWait({
                    peerIndices: survivors(),
                    timeout: WAIT
                });

                // continued honest activity on the twice-reduced fork -> survivors stay in sync
                for (let k = 0; k < 6; k++) {
                    await h.transition.advanceState({
                        waitForPeers: survivors()
                    });
                    await h.assert.sync.peersInSyncWait({
                        peerIndices: survivors(),
                        timeout: WAIT
                    });
                }
            }
        )
    );
});
