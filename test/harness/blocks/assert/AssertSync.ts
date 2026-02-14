import { HarnessBlock } from "../HarnessBlock";
import { expect } from "chai";

export class AssertSync {
    /**
     * Assert all peers are in sync with same block height and hash
     */
    static allPeersInSync(options?: { timeout?: number }) {
        const { timeout = 10000 } = options || {};
        return new HarnessBlock(async (harness) => {
            await harness.assertActions.assertAllPeersInSync({ timeout });
            return harness;
        });
    }

    /**
     * Assert all specified peers are in sync
     */
    static peersInSync(peerIndices: number[], options?: { timeout?: number }) {
        const { timeout = 10000 } = options || {};
        return new HarnessBlock(async (harness) => {
            await harness.assertActions.assertAllPeersInSync({
                peerIndices,
                timeout
            });
            return harness;
        });
    }

    /**
     * Assert block height matches expected value
     */
    static blockHeight(options: {
        expectedHeight: number;
        peerIndices?: number[];
    }) {
        return new HarnessBlock(async (harness) => {
            await harness.assertActions.blockHeight(options);
            return harness;
        });
    }

    /**
     * Assert fork changed to a new fork after dispute reduction
     */
    static forkChanged(options?: {
        timeoutMs?: number;
        minHonestPeers?: number;
    }) {
        const { timeoutMs = 10000, minHonestPeers = 3 } = options || {};

        return new HarnessBlock(async (harness) => {
            const originalForkId = harness.context.originalForkId;
            if (!originalForkId) {
                throw new Error(
                    "No original fork ID captured. Use Event.captureOriginalFork() before this assertion."
                );
            }

            await harness.assertActions.assertForkChanged({
                originalForkId,
                timeoutMs,
                minHonestPeers
            });

            return harness;
        });
    }

    /**
     * Assert fork did NOT change (remains at original fork)
     */
    static forkUnchanged() {
        return new HarnessBlock(async (harness) => {
            const originalForkId = harness.context.originalForkId;
            if (!originalForkId) {
                throw new Error(
                    "No original fork ID captured. Use Event.captureOriginalFork() before this assertion."
                );
            }

            const forkUnchanged = harness.peers.every(
                (p) => p.stateManager.forkId === originalForkId
            );

            if (!forkUnchanged) {
                const forkIds = harness.peers.map((p) => p.stateManager.forkId);
                throw new Error(
                    `Expected fork to remain ${originalForkId}, but found: ${JSON.stringify(forkIds)}`
                );
            }

            return harness;
        });
    }

    /**
     * Assert all honest peers are in sync (after fork resolution)
     */
    static onlyHonestPeersInSync() {
        return new HarnessBlock(async (harness) => {
            const honestIndices = harness.context.honestPeerIndices;
            if (!honestIndices) {
                throw new Error(
                    "honestPeerIndices not set - use Scenario.disputeWithReduction() or Byzantine.createAndResolveFork() first"
                );
            }

            await harness.assertActions.assertAllPeersInSync({
                peerIndices: honestIndices
            });

            return harness;
        });
    }

    /**
     * Assert the malicious peer is not the next to write
     */
    static maliciousPeerExcluded() {
        return new HarnessBlock(async (harness) => {
            const maliciousIndex = harness.context.maliciousPeerIndex;
            if (maliciousIndex === undefined) {
                throw new Error(
                    "maliciousPeerIndex not set - use Scenario.disputeWithReduction() or Byzantine.createAndResolveFork() first"
                );
            }

            const nextWriter = await harness.stateQuery.getNextPeerToWrite();

            if (nextWriter.index === maliciousIndex) {
                throw new Error(
                    `Malicious peer ${maliciousIndex} should not receive next turn, but it did`
                );
            }

            return harness;
        });
    }

    /**
     * Assert that a peer's block height is greater than another peer's
     */
    static peerBlockHeightGreaterThan(
        peerIndex: number,
        otherPeerIndex: number,
        options?: { timeoutMs?: number }
    ) {
        const { timeoutMs = 5000 } = options || {};

        return new HarnessBlock(async (harness) => {
            const forkId = harness.activeForkId;
            if (!forkId) {
                throw new Error("No active fork ID");
            }

            const condition = () => {
                const peerHeight =
                    harness.peers[
                        peerIndex
                    ].stateManager.storage.blocks.getNextBlockHeight(forkId);
                const otherHeight =
                    harness.peers[
                        otherPeerIndex
                    ].stateManager.storage.blocks.getNextBlockHeight(forkId);
                return peerHeight > otherHeight;
            };

            if (condition()) {
                return harness;
            }

            try {
                await harness.eventCountsBarrier.waitFor(condition, {
                    timeoutMs,
                    timeoutMessage: `Peer ${peerIndex} height did not exceed peer ${otherPeerIndex} within ${timeoutMs}ms`
                });
            } catch {
                const peerHeight =
                    harness.peers[
                        peerIndex
                    ].stateManager.storage.blocks.getNextBlockHeight(forkId);
                const otherHeight =
                    harness.peers[
                        otherPeerIndex
                    ].stateManager.storage.blocks.getNextBlockHeight(forkId);
                throw new Error(
                    `Peer ${peerIndex} block height (${peerHeight}) is not greater than peer ${otherPeerIndex} (${otherHeight})`
                );
            }

            return harness;
        });
    }

    /**
     * Assert participant count matches expected value
     */
    static participantCount({
        expectedCount,
        peerIndex = 0,
        timeoutMs = 10000
    }: {
        expectedCount: number;
        peerIndex?: number;
        timeoutMs?: number;
    }) {
        return new HarnessBlock(async (harness) => {
            const peer = harness.peers[peerIndex];
            if (!peer) {
                throw new Error(`Peer ${peerIndex} not found`);
            }

            let participants =
                await peer.stateManager.diamondStateMachine.getParticipants();

            if (participants.length === expectedCount) {
                expect(participants.length).to.equal(expectedCount);
                return harness;
            }

            const condition = async () => {
                const currentParticipants =
                    await peer.stateManager.diamondStateMachine.getParticipants();
                return currentParticipants.length === expectedCount;
            };

            await harness.eventCountsBarrier.waitFor(condition, {
                timeoutMs,
                timeoutMessage: `Participant count did not reach ${expectedCount} within ${timeoutMs}ms for peer ${peerIndex}`
            });

            participants =
                await peer.stateManager.diamondStateMachine.getParticipants();
            expect(participants.length).to.equal(expectedCount);

            return harness;
        });
    }
}
