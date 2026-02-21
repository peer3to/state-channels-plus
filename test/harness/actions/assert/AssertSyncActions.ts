import type { ForkId, Hash } from "@/types/types";
import { expect } from "chai";
import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";

export class AssertSyncActions {
    constructor(private readonly harness: PeerTestHarness) {}

    async peersInSync(options?: {
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
            this.harness.stateQuery.getLatestStateMachineStateHash(
                firstPeerIndex
            );

        for (let i = 1; i < peers.length; i++) {
            const peerIndex = peers[i].index;
            const peerState =
                this.harness.stateQuery.getLatestStateMachineStateHash(
                    peerIndex
                );

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

    async forkChanged(options: {
        originalForkId: ForkId;
        timeoutMs?: number;
        minHonestPeers?: number;
    }): Promise<void> {
        const {
            originalForkId,
            timeoutMs = 10000,
            minHonestPeers = 3
        } = options;

        const { ZeroHash } = await import("ethers");
        const forkChanged = await this.harness.waitForForkChange({
            excludeForkIds: [originalForkId, ZeroHash],
            timeoutMs
        });

        if (!forkChanged) {
            const peerForks = this.harness.peers
                .map((p) => p.stateManager.forkId)
                .filter(
                    (forkId) => forkId !== ZeroHash && forkId !== originalForkId
                );
            const peersOnNewFork = peerForks.length;
            throw new Error(
                `Fork did not change within ${timeoutMs}ms. Expected at least ${minHonestPeers} peers on new fork, got ${peersOnNewFork}.`
            );
        }
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
        const honestIndices = this.harness.context.honestPeerIndices;
        if (!honestIndices) {
            throw new Error(
                "honestPeerIndices not set - resolve dispute context first"
            );
        }

        await this.peersInSync({ peerIndices: honestIndices });
    }

    async maliciousPeerExcluded(): Promise<void> {
        const maliciousIndex = this.harness.context.maliciousPeerIndex;
        if (maliciousIndex === undefined) {
            throw new Error(
                "maliciousPeerIndex not set - resolve dispute context first"
            );
        }

        const nextWriter = await this.harness.stateQuery.getNextPeerToWrite();
        if (nextWriter.index === maliciousIndex) {
            throw new Error(
                `Malicious peer ${maliciousIndex} should not receive next turn, but it did`
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
