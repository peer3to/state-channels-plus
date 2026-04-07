import { Logger } from "@/utils";
import { ForkId } from "@/types/types";
import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import { CreateAndResolveDisputeResult, HarnessOptions } from "../core/types";

export class ScenarioActions {
    constructor(
        private harness: PeerTestHarness,
        private logger: Logger
    ) {}

    async fourPeersDisputeResolution(options?: {
        timeConfig?: {
            p2pTime?: number;
            agreementTime?: number;
            chainFallbackTime?: number;
            evidenceTime?: number;
        };
    }) {
        await this.harness.lifecycle.start(4, 2, options);
        await this.harness.assert.sync.peersInSyncWait();
        await this.disputeWithReduction({ maliciousPeerIndex: 2 });
        await this.harness.assert.sync.forkChangedWait();
    }

    async fourPeersDisputeResolutionAndSnapshotUpdateDetached(options?: {
        timeConfig?: {
            p2pTime?: number;
            agreementTime?: number;
            chainFallbackTime?: number;
            evidenceTime?: number;
        };
    }) {
        await this.fourPeersDisputeResolution(options);
        const expectedSnapshot = await this.harness.transition.postSnapshot({
            peerIndex: 0
        });
        await this.harness.assert.snapshot.onChainSnapshotChangedDetached({
            expectedSnapshot
        });
    }

    async fourPeersDisputeResolutionAndSnapshotUpdateWait(options?: {
        timeConfig?: {
            p2pTime?: number;
            agreementTime?: number;
            chainFallbackTime?: number;
            evidenceTime?: number;
        };
    }) {
        await this.fourPeersDisputeResolution(options);
        const expectedSnapshot = await this.harness.transition.postSnapshot({
            peerIndex: 0
        });
        await this.harness.assert.snapshot.onChainSnapshotChangedWait({
            expectedSnapshot
        });
    }

    async preDisputeSetup(peerCount: number = 3) {
        await this.harness.lifecycle.timeoutSetup(peerCount, 2);
        await this.harness.assert.sync.peersInSyncWait();
        this.harness.event.resetEventSpies();
        this.harness.contextApi.captureOriginalFork();
    }

    // 4 peers, peer 2 is leaving, next turn is peer 1
    //  5 blocks in this pre-setp, block height is 4
    async preDisputeSetupCalldataPath() {
        await this.preDisputeSetup(4);
        await this.harness.transition.participantLeaveWait();
        await this.harness.transition.advanceState({
            waitForPeers: [0, 1, 3],
            count: 2
        });
        this.harness.contextApi.captureOriginalFork();
        this.harness.event.resetEventSpies();
    }

    async preDisputeSetupDisconnectedPeer() {
        await this.harness.lifecycle.timeoutSetup(4, 0);
        await this.harness.network.disconnectPeer(2);
        await this.harness.transition.advanceState({
            waitForPeers: [0, 1, 3],
            count: 2
        });

        this.harness.event.resetEventSpies();
        this.harness.contextApi.captureOriginalFork();
    }

    async peerWithUnbroadcastedBlock(peerIndex: number = 1) {
        await this.harness.assert.sync.peersInSyncWait();
        this.harness.event.resetEventSpies();
        this.harness.byzantine.stubBroadcast(peerIndex);
        await this.harness.transition.advanceState({ waitForSync: false });
    }

    async spectatorJoinedAndSynced(
        initialTransitions: number = 3,
        options?: HarnessOptions
    ) {
        await this.harness.lifecycle.start(3, 0, options);
        await this.harness.assert.sync.participantCount({ expectedCount: 3 });
        await this.harness.transition.advanceState({
            count: initialTransitions
        });
        await this.harness.event.resetEventSpies();
        await this.harness.join.addPeerWait();
        await this.harness.assert.sync.peersInSyncWait({
            peerIndices: [0, 1, 2, 3]
        });
    }

    async readyForRedispute() {
        await this.harness.lifecycle.start(4, 0);

        await this.harness.byzantine.disconnect(3);
        await this.harness.transition.advanceState({ txFn: (c) => c.add(1) });
        await this.harness.assert.sync.peersInSyncWait({
            peerIndices: [0, 1, 2]
        });
        this.harness.event.resetEventSpies();
    }

    async activeChannelWithDispute(options: {
        numPeers: number;
        numBlocks: number;
        byzantinePeer: number;
    }) {
        const { numPeers, numBlocks, byzantinePeer } = options;

        await this.harness.lifecycle.start(numPeers, numBlocks);
        await this.harness.byzantine.submitDoubleSignBlock(byzantinePeer);
        await this.harness.assert.dispute.committedWait();
        this.harness.event.resetEventSpies();
    }

    async disputeWithReduction(options: {
        maliciousPeerIndex: number;
        honestPeerIndices?: number[];
        forkSettleTimeoutMs?: number;
        disputesCommittedTimeoutMs?: number;
    }): Promise<CreateAndResolveDisputeResult> {
        return this.disputeAndResolve({
            maliciousPeerIndex: options.maliciousPeerIndex,
            honestPeerIndices: options.honestPeerIndices,
            forkSettleTimeoutMs: options.forkSettleTimeoutMs,
            disputesCommittedTimeoutMs: options.disputesCommittedTimeoutMs,
            disputesCommittedMode: "atLeast",
            assertMaliciousRemoved: false
        });
    }

    async disputeAndResolve(options: {
        maliciousPeerIndex: number;
        forkId?: ForkId;
        honestPeerIndices?: number[];
        resetEventSpies?: boolean;
        disputesCommittedTimeoutMs?: number;
        forkSettleTimeoutMs?: number;
        expectedDisputesCommittedPerPeer?: number;
        disputesCommittedMode?: "exact" | "atLeast";
        assertMaliciousRemoved?: boolean;
    }): Promise<CreateAndResolveDisputeResult> {
        const originalForkId = options.forkId || this.harness.activeForkId!;
        const honestPeerIndices =
            options.honestPeerIndices ??
            this.harness.peers
                .map((_, i) => i)
                .filter((i) => i !== options.maliciousPeerIndex);

        this.harness.contextApi.markMaliciousPeer({
            maliciousPeerIndex: options.maliciousPeerIndex,
            honestPeerIndices
        });

        await this.harness.dispute.createInvalidStateTransitionDispute(
            options.maliciousPeerIndex,
            {
                forkId: originalForkId,
                resetEventSpies: options.resetEventSpies ?? true
            }
        );

        const result = await this.harness.dispute.resolveDisputeWait({
            maliciousPeerIndices: [options.maliciousPeerIndex],
            forkId: originalForkId,
            honestPeerIndices,
            disputesCommittedTimeoutMs: options.disputesCommittedTimeoutMs,
            forkSettleTimeoutMs: options.forkSettleTimeoutMs,
            expectedDisputesCommittedPerPeer:
                options.expectedDisputesCommittedPerPeer,
            disputesCommittedMode: options.disputesCommittedMode,
            assertMaliciousRemoved: options.assertMaliciousRemoved ?? false
        });

        this.harness.context.originalForkId = originalForkId;

        this.logger.debug(
            `Scenario disputeAndResolve completed: maliciousPeer=${options.maliciousPeerIndex}, originalFork=${originalForkId}, newFork=${result.newForkId}`
        );

        return result;
    }
}
