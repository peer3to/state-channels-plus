import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import { Logger } from "@/utils";
import { expect } from "chai";
import { ForkId } from "@/types/types";

export class AssertActions {
    constructor(
        private harness: PeerTestHarness<any, any>,
        private logger: Logger
    ) {}

    async disputeInitiatedBy(
        peerIndices: number[],
        timeout: number = 5000
    ): Promise<void> {
        const expectedCounts = peerIndices.map((peerId) => ({
            peerId,
            expectedCount: 1
        }));

        const disputeCreated =
            await this.harness.eventActions.waitForEventCounts(
                "onInitiatingDispute",
                expectedCounts,
                timeout
            );

        expect(disputeCreated).to.be.true;

        const allPeerIndices = this.harness.peers.map((p) => p.index);
        const nonInitiators = allPeerIndices.filter(
            (i) => !peerIndices.includes(i)
        );

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

    async disputeCommitted(
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

    async calldataPosted(
        peerIndex: number,
        timeout: number = 3000
    ): Promise<void> {
        const success = await this.harness.eventActions.waitForEventCounts(
            "onPostingCalldata",
            [{ peerId: peerIndex, expectedCount: 1 }],
            timeout,
            { mode: "atLeast" }
        );

        expect(success).to.be.true;
        expect(
            this.harness.eventActions.getEventCallCount(
                peerIndex,
                "onPostingCalldata"
            )
        ).to.be.at.least(1);
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

    async peerOutOfSync(peerIndex: number): Promise<void> {
        const forkId = this.harness.activeForkId;
        if (!forkId) {
            throw new Error("No active fork ID");
        }

        const targetBlock =
            this.harness.peers[
                peerIndex
            ].stateManager.storage.blocks.getLatestBlock(forkId);
        const otherBlocks = this.harness.peers
            .filter((_, i) => i !== peerIndex)
            .map((p) => p.stateManager.storage.blocks.getLatestBlock(forkId));

        const isDifferent = otherBlocks.some(
            (block) => block?.hash !== targetBlock?.hash
        );

        expect(isDifferent).to.be.true;
    }

    /**
     * Assert all peers are in sync (block hash and state match)
     */
    assertAllPeersInSync(
        options: { expectedState?: any; peerIndices?: number[] } = {}
    ): void {
        const { expectedState, peerIndices } = options;
        const indicesToCheck =
            peerIndices ??
            Array.from({ length: this.harness.peers.length }, (_, i) => i);

        if (indicesToCheck.length < 2)
            throw new Error("Need at least 2 peers to check sync");

        const syncStatus = this.harness["syncCoordinator"].checkPeersInSync(
            this.harness.peers,
            this.harness.activeForkId!,
            peerIndices
        );

        if (!syncStatus.inSync) {
            const details = syncStatus.syncDetails
                .map(
                    (d) =>
                        `Peer ${d.peerIndex}: hash=${d.blockHash} height=${d.height}`
                )
                .join("; ");
            throw new Error(`Peers not in sync - ${details}`);
        }

        // Check state machine state synchronization
        const firstPeerIndex = indicesToCheck[0];
        const firstPeerState = this.harness.stateQuery.getStateMachineState(
            firstPeerIndex,
            this.harness.activeForkId!
        );

        for (let i = 1; i < indicesToCheck.length; i++) {
            const peerIndex = indicesToCheck[i];
            const peerState = this.harness.stateQuery.getStateMachineState(
                peerIndex,
                this.harness.activeForkId!
            );

            expect(peerState).to.deep.equal(
                firstPeerState,
                `Peer ${peerIndex} state does not match Peer ${firstPeerIndex}`
            );
        }

        if (expectedState !== undefined) {
            expect(firstPeerState).to.deep.equal(
                expectedState,
                "State does not match expected state"
            );
        }
    }

    /**
     * Verify all peers have acknowledged a disputed fork
     */
    async verifyAllPeersAcknowledged(
        requestingPeerIndex: number,
        forkId: ForkId,
        timeoutMs: number = 5000,
        excludePeerIndices: number[] = []
    ): Promise<boolean> {
        const requestingPeer = this.harness.getPeer(requestingPeerIndex);
        const requestingPeerService =
            requestingPeer.stateManager.p2pManager.localRpc
                .isForkDisputedService;

        const condition = () => {
            const connections =
                requestingPeer.stateManager.p2pManager.openConnections;

            if (connections.length === 0) return false;

            const allAcked = connections.every((transport) => {
                const profile =
                    requestingPeer.stateManager.p2pManager.profileManager.getProfileByTransport(
                        transport
                    );
                const peerIndex = this.harness.peers.findIndex(
                    (p) => p.address === profile?.evmAddress
                );

                // Skip excluded peers
                if (
                    peerIndex !== -1 &&
                    excludePeerIndices.includes(peerIndex)
                ) {
                    return true;
                }

                const peerAddress = transport.peerAddress
                    ? transport.peerAddress
                    : profile?.evmAddress
                      ? profile.evmAddress.toString()
                      : undefined;
                if (!peerAddress) return false;

                return requestingPeerService.didPeerAcknowledgeDisputedFork(
                    peerAddress,
                    forkId
                );
            });
            return allAcked;
        };

        // Check immediately
        if (condition()) return true;

        // Use event barrier for efficient waiting (triggers on network/state events)
        try {
            await this.harness.eventCountsBarrier.waitFor(condition, {
                timeoutMs,
                timeoutMessage: `Not all peers acknowledged within ${timeoutMs}ms`
            });
            return true;
        } catch {
            return false;
        }
    }
}
