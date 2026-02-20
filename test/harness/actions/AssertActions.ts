import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import { Logger } from "@/utils";
import { expect } from "chai";
import { ForkId, Hash } from "@/types/types";
import { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import type { EventBarrierCapturedError } from "@/utils/EventBarrier";

export class AssertActions {
    constructor(
        private harness: PeerTestHarness,
        private logger: Logger
    ) {}

    async disputeInitiatedByPeers(options: {
        peersIndices?: number[];
        timeoutMs?: number;
    }): Promise<void> {
        const { peersIndices, timeoutMs = 5000 } = options;

        let peers = this.harness.getFilteredPeers(peersIndices);
        const maliciousPeerIndex = this.harness.context.lastMaliciousPeerIndex;
        if (maliciousPeerIndex)
            peers = peers.filter((peer) => peer.index !== maliciousPeerIndex);

        const expectedCounts = peers.map((peer) => ({
            peerId: peer.index,
            expectedCount: 1
        }));

        const disputeCreated =
            await this.harness.eventActions.waitForEventCounts(
                "onInitiatingDispute",
                expectedCounts,
                timeoutMs
            );

        expect(disputeCreated).to.be.true;

        const nonInitiators = this.harness.peers.filter(
            (peer) => !peers.includes(peer)
        );

        for (const peer of nonInitiators) {
            const count = this.harness.eventActions.getEventCallCount(
                peer.index,
                "onInitiatingDispute"
            );
            expect(count).to.equal(
                0,
                `Peer ${peer.index} should not have initiated dispute`
            );
        }
    }

    async disputeCommittedByPeers(options?: {
        expectedCount?: number;
        timeoutMs?: number;
        peersIndices?: number[];
    }): Promise<void> {
        const {
            expectedCount = 2,
            timeoutMs = 5000,
            peersIndices
        } = options || {};

        const peers = this.harness.getFilteredPeers(peersIndices);

        const expectedCounts = peers.map((p) => ({
            peerId: p.index,
            expectedCount: expectedCount
        }));

        const disputeCommitted =
            await this.harness.eventActions.waitForEventCounts(
                "onDisputeCommitted",
                expectedCounts,
                timeoutMs
            );

        expect(disputeCommitted).to.be.true;
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

    /**
     * Assert all peers are in sync (block hash and state match)
     */
    async assertPeersInSync(
        options: {
            expectedStateMachineStateHash?: Hash;
            peerIndices?: number[];
            timeout?: number;
        } = {}
    ): Promise<void> {
        const {
            expectedStateMachineStateHash,
            peerIndices,
            timeout = 10000
        } = options;
        const peers = this.harness.getFilteredPeers(peerIndices);
        if (peers.length < 2)
            throw new Error("Need at least 2 peers to check sync");

        const forkId = this.harness.activeForkId;
        if (!forkId) {
            throw new Error("No active fork ID - cannot wait for sync");
        }

        // Wait for peers to sync using the event barrier approach
        await this.harness.syncCoordinator.waitForPeersToSync(
            peers,
            forkId,
            timeout
        );

        // Check state machine state synchronization
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

    /**
     * Assert calldata was posted by any peer
     */
    async calldataPostedByAny(options?: { timeoutMs?: number }): Promise<void> {
        const { timeoutMs = 5000 } = options || {};

        const condition = () => {
            return this.harness.peers.some(
                (peer) =>
                    this.harness.eventActions.getEventCallCount(
                        peer.index,
                        "onPostedCalldata"
                    ) > 0 ||
                    this.harness.eventActions.getEventCallCount(
                        peer.index,
                        "onBlockCalldataPosted"
                    ) > 0
            );
        };

        // Check immediately
        if (condition()) {
            return;
        }

        // Use event barrier
        await this.harness.eventCountsBarrier.waitFor(condition, {
            timeoutMs,
            timeoutMessage: `No calldata was posted within ${timeoutMs}ms`
        });
    }

    /**
     * Assert no disputes occurred (neither initiated nor committed)
     */
    assertNoDisputes(): void {
        const totalInitiated = this.harness.peers.reduce((sum, peer) => {
            return (
                sum +
                this.harness.eventActions.getEventCallCount(
                    peer.index,
                    "onInitiatingDispute"
                )
            );
        }, 0);

        const totalCommitted = this.harness.peers.reduce((sum, peer) => {
            return (
                sum +
                this.harness.eventActions.getEventCallCount(
                    peer.index,
                    "onDisputeCommitted"
                )
            );
        }, 0);

        if (totalInitiated > 0) {
            throw new Error(
                `Expected no disputes to be initiated, but ${totalInitiated} were initiated`
            );
        }

        if (totalCommitted > 0) {
            throw new Error(
                `Expected no disputes to be committed, but ${totalCommitted} were committed`
            );
        }
    }

    /**
     * Assert no calldata was posted
     */
    assertNoCalldataPosted(): void {
        const totalPosted = this.harness.peers.reduce((sum, peer) => {
            return (
                sum +
                this.harness.eventActions.getEventCallCount(
                    peer.index,
                    "onPostedCalldata"
                )
            );
        }, 0);

        const totalBlockCalldata = this.harness.peers.reduce((sum, peer) => {
            return (
                sum +
                this.harness.eventActions.getEventCallCount(
                    peer.index,
                    "onBlockCalldataPosted"
                )
            );
        }, 0);

        if (totalPosted > 0 || totalBlockCalldata > 0) {
            throw new Error(
                `Expected no calldata to be posted, but onPostedCalldata: ${totalPosted}, onBlockCalldataPosted: ${totalBlockCalldata}`
            );
        }
    }

    /**
     * Assert timeout is forced for a specific participant
     */
    assertTimeoutIsForced(options: {
        participant: number;
        peerToCheck?: number;
        forkId: ForkId;
    }): void {
        const { participant, peerToCheck = 0, forkId } = options;

        const timeout =
            this.harness.peers[
                peerToCheck
            ].stateManager.storage.timeout.getTimeout(forkId);

        if (!timeout) {
            throw new Error(`No timeout found for fork ${forkId}`);
        }

        if (!timeout.isForced) {
            throw new Error(`Expected timeout to be forced, but it was not`);
        }

        if (timeout.participant !== this.harness.peers[participant].address) {
            throw new Error(
                `Expected timeout participant to be peer ${participant} (${this.harness.peers[participant].address}), ` +
                    `but was ${timeout.participant}`
            );
        }
    }

    /**
     * Assert fork changed to a new fork after dispute resolution
     */
    async assertForkChanged(options: {
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
            // Additional check to provide better error message
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

    /**
     * Assert dispute fraud proof was stored for a dispute
     */
    async assertDisputeFraudProofStored(options: {
        dispute: DisputeStruct;
        timeoutMs?: number;
        peerIndices?: number[];
    }): Promise<void> {
        const { dispute, timeoutMs = 2000, peerIndices } = options;
        const peers = this.harness.getFilteredPeers(peerIndices);
        const condition = () => {
            return peers.every((peer) => {
                const proof =
                    peer.stateManager.storage.disputeFraudProofs.getDisputeFraudProofForDispute(
                        dispute
                    );
                return !!proof;
            });
        };

        // Check immediately first
        if (condition()) {
            return;
        }

        // Use event barrier (fires on dispute/state events)
        try {
            await this.harness.eventCountsBarrier.waitFor(condition, {
                timeoutMs,
                timeoutMessage: `Dispute fraud proof was not stored on all peers within ${timeoutMs}ms`
            });
        } catch (error) {
            const barrierError = error as EventBarrierCapturedError;
            this.logger.error("assertDisputeFraudProofStored waitFor failed", {
                error,
                capturedBarrierStack: barrierError.capturedBarrierStack,
                timeoutMs,
                peerIndices: peers.map((peer) => peer.index)
            });
            const wrappedError = new Error(
                `Dispute fraud proof was not stored on all peers within ${timeoutMs}ms`
            ) as EventBarrierCapturedError;
            wrappedError.capturedBarrierStack =
                barrierError.capturedBarrierStack;
            throw wrappedError;
        }
    }
}
