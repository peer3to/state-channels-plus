import { MathTestSession as TestSession } from "@test/harness";

/**
 * Repro of the reduced-fork clock skew (writeup: docs/reduced-fork-timestamp-mismatch.md).
 * Two reductions (fork A→B→C) + honest activity. A reduced fork's genesisTimestamp =
 * onChainKillTimestamp + evidenceTime (StateManager.ts) is future-dated, but block.timestamp comes
 * from Clock.getTimeInSeconds(). When local clocks lag, block.timestamp < previousOriginalTimestamp
 * → hasInvalidTimestamp() rejects the honest block → peers desync.
 * Test-only: live peers share real time so the clocks stay aligned.
 * Proof: ValidationService logs "TIMING-MISMATCH" when previousOriginalTimestamp > Clock.getTimeInSeconds().
 * Deliberately RED; mark it.skip for CI once acknowledged.
 * Run: yarn test:e2e:log-file --grep "fork A→B→C; advanceState"
 */

const TIME = { evidenceTime: 10 };
const RESOLVE = {
    forkSettleTimeoutMs: 90000,
    disputesCommittedTimeoutMs: 30000
};
const WAIT = 45000;

describe("E2E: dispute validation / reducedForkTimestampMismatch", function () {
    it("fork A→B→C; advanceState → block.timestamp ∉ [previousOriginalTimestamp .. previousTimestamp+p2pTime] → peers desync", async function () {
        this.timeout(300000);
        const h = TestSession.getHarness();
        const survivors = () =>
            h.getPeersExcludingMaliciousAndLeavers().map((p) => p.index);

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

        // continued honest activity -> trips the future-dated fork-start timestamp check
        for (let k = 0; k < 6; k++) {
            await h.transition.advanceState({ waitForPeers: survivors() });
            await h.assert.sync.peersInSyncWait({
                peerIndices: survivors(),
                timeout: WAIT
            });
        }
    });
});
