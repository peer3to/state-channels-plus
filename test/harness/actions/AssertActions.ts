import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import { Logger } from "@/utils";
import { expect } from "chai";
import { ForkId, Hash } from "@/types/types";
import { SnapshotDataStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";

export class AssertActions {
    constructor(
        private harness: PeerTestHarness,
        private logger: Logger
    ) {}

    async disputeInitiatedBy(options: {
        peers: number[];
        timeoutMs?: number;
    }): Promise<void> {
        const { peers, timeoutMs = 5000 } = options;

        const expectedCounts = peers.map((peerId) => ({
            peerId,
            expectedCount: 1
        }));

        const disputeCreated =
            await this.harness.eventActions.waitForEventCounts(
                "onInitiatingDispute",
                expectedCounts,
                timeoutMs
            );

        expect(disputeCreated).to.be.true;

        const allPeerIndices = this.harness.peers.map((p) => p.index);
        const nonInitiators = allPeerIndices.filter((i) => !peers.includes(i));

        for (const peerIndex of nonInitiators) {
            const count = this.harness.eventActions.getEventCallCount(
                peerIndex,
                "onInitiatingDispute"
            );
            expect(count).to.equal(
                0,
                `Peer ${peerIndex} should not have initiated dispute`
            );
        }
    }

    async disputeCommittedByAllPeers(
        timeout: number = 5000,
        expectedCount: number
    ): Promise<void> {
        const expectedCounts = this.harness.peers.map((p) => ({
            peerId: p.index,
            expectedCount: expectedCount
        }));

        const disputeCommitted =
            await this.harness.eventActions.waitForEventCounts(
                "onDisputeCommitted",
                expectedCounts,
                timeout
            );

        expect(disputeCommitted).to.be.true;
    }

    async blockHeight(expectedHeight: number): Promise<void> {
        const forkId = this.harness.activeForkId;
        if (!forkId) {
            throw new Error("No active fork ID");
        }

        const latestBlock =
            this.harness.peers[0].stateManager.storage.blocks.getLatestBlock(
                forkId
            );
        expect(latestBlock).to.not.equal(
            undefined,
            "Should have a latest block"
        );
        expect(latestBlock?.height).to.equal(
            expectedHeight,
            `Block height should be ${expectedHeight}`
        );
    }

    /**
     * Assert all peers are in sync (block hash and state match)
     */
    async assertAllPeersInSync(
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
        const indicesToCheck =
            peerIndices ??
            Array.from({ length: this.harness.peers.length }, (_, i) => i);

        if (indicesToCheck.length < 2)
            throw new Error("Need at least 2 peers to check sync");

        const forkId = this.harness.activeForkId;
        if (!forkId) {
            throw new Error("No active fork ID - cannot wait for sync");
        }

        // Wait for peers to sync using the event barrier approach
        await this.harness.syncCoordinator.waitForPeersInSync(
            this.harness.peers,
            forkId,
            {
                timeout,
                peerIndices
            }
        );

        // Check state machine state synchronization
        const firstPeerIndex = indicesToCheck[0];
        const firstPeerState =
            this.harness.stateQuery.getLatestStateMachineStateHash(
                firstPeerIndex
            );

        for (let i = 1; i < indicesToCheck.length; i++) {
            const peerIndex = indicesToCheck[i];
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
     * Assert all peers committed disputes with expected count per peer
     */
    async disputeCommittedByAll(options?: {
        expectedCountPerPeer?: number;
        timeoutMs?: number;
    }): Promise<void> {
        const { expectedCountPerPeer = 1, timeoutMs = 5000 } = options || {};

        const condition = () => {
            return this.harness.peers.every(
                (peer) =>
                    this.harness.eventActions.getEventCallCount(
                        peer.index,
                        "onDisputeCommitted"
                    ) >= expectedCountPerPeer
            );
        };

        // Check immediately
        if (condition()) {
            return;
        }

        // Use event barrier
        await this.harness.eventCountsBarrier.waitFor(condition, {
            timeoutMs,
            timeoutMessage: `All peers did not commit ${expectedCountPerPeer} disputes within ${timeoutMs}ms`
        });
    }

    /**
     * Assert honest peers initiated disputes
     * Uses honest peer indices from harness context (set by Byzantine blocks)
     */
    async honestPeersInitiateDispute(options?: {
        timeoutMs?: number;
        expectedCountPerPeer?: number;
    }): Promise<void> {
        const { timeoutMs = 5000, expectedCountPerPeer = 1 } = options || {};

        // Get malicious peer index (set by Byzantine blocks)
        const maliciousPeerIndex = this.harness.context.lastMaliciousPeerIndex;
        if (maliciousPeerIndex === undefined) {
            throw new Error(
                "No malicious peer index found. This should be used after a Byzantine attack block."
            );
        }

        // Get honest peers (all except malicious)
        const honestPeers = this.harness.peers
            .filter((peer) => peer.index !== maliciousPeerIndex)
            .map((peer) => peer.index);

        const condition = () => {
            return honestPeers.every(
                (peerId) =>
                    this.harness.eventActions.getEventCallCount(
                        peerId,
                        "onInitiatingDispute"
                    ) >= expectedCountPerPeer
            );
        };

        // Check immediately
        if (condition()) {
            return;
        }

        // Use event barrier
        await this.harness.eventCountsBarrier.waitFor(condition, {
            timeoutMs,
            timeoutMessage: `Honest peers ${honestPeers.join(", ")} did not initiate ${expectedCountPerPeer} disputes within ${timeoutMs}ms`
        });
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
     * Assert fraud proof was stored for a dispute
     */
    async assertDisputeFraudProofStored(options: {
        dispute: DisputeStruct;
        timeoutMs?: number;
    }): Promise<void> {
        const { dispute, timeoutMs = 2000 } = options;

        const condition = () => {
            return this.harness.peers.every((peer) => {
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
                timeoutMessage: `Fraud proof was not stored on all peers within ${timeoutMs}ms`
            });
        } catch (error) {
            throw new Error(
                `Fraud proof was not stored on all peers within ${timeoutMs}ms`
            );
        }
    }
}
