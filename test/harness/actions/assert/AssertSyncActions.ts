import type { ForkId, Hash } from "@/types/types";
import { expect } from "chai";
import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import { ZeroHash } from "ethers";

export class AssertSyncActions {
    constructor(private readonly harness: PeerTestHarness) {}

    async peersInSyncWait(options?: {
        expectedStateMachineStateHash?: Hash;
        peerIndices?: number[];
        timeout?: number;
    }): Promise<void> {
        const {
            expectedStateMachineStateHash,
            peerIndices,
            timeout = 10000
        } = options || {};
        const peers = this.harness.getFilteredPeers(peerIndices);
        if (peers.length < 2)
            throw new Error("Need at least 2 peers to check sync");

        const forkId = this.harness.activeForkId;
        if (!forkId) {
            throw new Error("No active fork ID - cannot wait for sync");
        }

        await this.harness.syncCoordinator.waitForPeersToSync(
            peers,
            forkId,
            timeout
        );

        const firstPeerIndex = peers[0].index;
        const firstPeerState =
            this.harness.query.getLatestStateMachineStateHash(firstPeerIndex);

        for (let i = 1; i < peers.length; i++) {
            const peerIndex = peers[i].index;
            const peerState =
                this.harness.query.getLatestStateMachineStateHash(peerIndex);

            expect(peerState).to.deep.equal(
                firstPeerState,
                `Peer ${peerIndex} state does not match Peer ${firstPeerIndex}`
            );
        }

        if (expectedStateMachineStateHash !== undefined) {
            expect(firstPeerState).to.deep.equal(
                expectedStateMachineStateHash,
                "State does not match expected state"
            );
        }
    }

    async blockHeight(options: {
        expectedHeight: number;
        peerIndices?: number[];
    }): Promise<void> {
        const { expectedHeight, peerIndices } = options;
        const peers = this.harness.getFilteredPeers(peerIndices);
        if (peers.length === 0) {
            throw new Error("No peers available to check block height");
        }

        const forkId = this.harness.activeForkId;
        if (!forkId) {
            throw new Error("No active fork ID");
        }

        for (const peer of peers) {
            const latestBlock =
                peer.stateManager.storage.blocks.getLatestBlock(forkId);
            expect(latestBlock).to.not.equal(
                undefined,
                `Peer ${peer.index} should have a latest block`
            );
            expect(latestBlock?.height).to.equal(
                expectedHeight,
                `Peer ${peer.index} block height should be ${expectedHeight}`
            );
        }
    }

    forkChanged(options?: {
        originalForkId?: ForkId;
        expectedForkId?: ForkId;
        excludeForkIds?: ForkId[];
        honestPeerIndices?: number[];
    }) {
        const {
            originalForkId = this.harness.context.originalForkId ||
                this.harness.activeForkId!,
            expectedForkId,
            excludeForkIds = [],
            honestPeerIndices
        } = options || {};

        const peers = this.harness.getFilteredOrHonestPeers(honestPeerIndices);

        const excludeSet = new Set([
            ...excludeForkIds,
            ZeroHash,
            originalForkId
        ]);

        const peerForks = peers
            .map((p) => p.stateManager.forkId)
            .filter((fid) => !excludeSet.has(fid));

        if (peerForks.length != peers.length)
            throw new Error(
                `Not all peers have moved to a new fork - expected ${peers.length}, actual ${peerForks.length}`
            );

        if (expectedForkId) {
            const isGood = peerForks.every((fid) => fid === expectedForkId);
            if (!isGood)
                throw new Error(
                    `Expected all peers to move to fork ${expectedForkId}, but found: ${JSON.stringify(peerForks)}`
                );
            return;
        } else {
            // All peers have moved to same new fork
            const uniqueForks = new Set(peerForks);
            const isGood = uniqueForks.size === 1;
            if (!isGood)
                throw new Error(
                    `Expected all peers to move to the same new fork, but found: ${JSON.stringify(peerForks)}`
                );
            return;
        }
    }
    async forkChangedWait(options?: {
        originalForkId?: ForkId;
        expectedForkId?: ForkId;
        excludeForkIds?: ForkId[];
        honestPeerIndices?: number[];
        timeoutMs?: number;
    }): Promise<void> {
        const { timeoutMs = 5000 } = options || {};
        const condition = () => {
            try {
                this.forkChanged(options);
                return true;
            } catch (error) {
                return false;
            }
        };

        await this.harness.eventCountsBarrier.waitFor(condition, {
            timeoutMs,
            timeoutMessage: `Fork change not detected within ${timeoutMs}ms`,
            timeoutMessageFn: () => {
                let errorMsg = `Fork change not detected within ${timeoutMs}ms`;
                try {
                    this.forkChanged(options);
                } catch (error) {
                    errorMsg += ` - ${error instanceof Error ? error.message : String(error)}`;
                }
                return errorMsg;
            }
        });
    }

    forkUnchanged(): void {
        const originalForkId = this.harness.context.originalForkId;
        if (!originalForkId) {
            throw new Error(
                "No original fork ID captured. Call captureOriginalFork() first."
            );
        }

        const forkUnchanged = this.harness.peers.every(
            (p) => p.stateManager.forkId === originalForkId
        );

        if (!forkUnchanged) {
            const forkIds = this.harness.peers.map(
                (p) => p.stateManager.forkId
            );
            throw new Error(
                `Expected fork to remain ${originalForkId}, but found: ${JSON.stringify(forkIds)}`
            );
        }
    }

    async onlyHonestPeersInSync(): Promise<void> {
        const honestIndices = this.harness.getHonestPeers().map((p) => p.index);
        if (!honestIndices || honestIndices.length === 0) {
            throw new Error("No honest peers found");
        }

        await this.peersInSyncWait({ peerIndices: honestIndices });
    }

    async maliciousPeerExcluded(): Promise<void> {
        const maliciousIndices = this.harness.context.maliciousPeerIndices;
        if (!maliciousIndices || maliciousIndices.length === 0) {
            throw new Error(
                "maliciousPeerIndex not set - resolve dispute context first"
            );
        }

        const nextWriter = await this.harness.query.getNextPeerToWrite();
        if (maliciousIndices.includes(nextWriter.index)) {
            throw new Error(
                `Malicious peer ${nextWriter.index} should not receive next turn, but it did`
            );
        }
    }

    async peerBlockHeightGreaterThan(
        peerIndex: number,
        otherPeerIndex: number,
        options?: { timeoutMs?: number }
    ): Promise<void> {
        const { timeoutMs = 5000 } = options || {};
        const forkId = this.harness.activeForkId;
        if (!forkId) {
            throw new Error("No active fork ID");
        }

        const condition = () => {
            const peerHeight =
                this.harness.peers[
                    peerIndex
                ].stateManager.storage.blocks.getNextBlockHeight(forkId);
            const otherHeight =
                this.harness.peers[
                    otherPeerIndex
                ].stateManager.storage.blocks.getNextBlockHeight(forkId);
            return peerHeight > otherHeight;
        };

        if (!condition()) {
            await this.harness.eventCountsBarrier.waitFor(condition, {
                timeoutMs,
                timeoutMessage: `Peer ${peerIndex} height did not exceed peer ${otherPeerIndex} within ${timeoutMs}ms`
            });
        }
    }

    async participantCount(options: {
        expectedCount: number;
        peerIndex?: number;
        timeoutMs?: number;
    }): Promise<void> {
        const { expectedCount, peerIndex = 0, timeoutMs = 10000 } = options;

        const peer = this.harness.peers[peerIndex];
        if (!peer) {
            throw new Error(`Peer ${peerIndex} not found`);
        }

        const condition = async () => {
            const participants =
                await peer.stateManager.diamondStateMachine.getParticipants();
            return participants.length === expectedCount;
        };

        if (!(await condition())) {
            await this.harness.eventCountsBarrier.waitFor(condition, {
                timeoutMs,
                timeoutMessage: `Participant count did not reach ${expectedCount} within ${timeoutMs}ms for peer ${peerIndex}`
            });
        }

        const participants =
            await peer.stateManager.diamondStateMachine.getParticipants();
        expect(participants.length).to.equal(expectedCount);
    }
}
