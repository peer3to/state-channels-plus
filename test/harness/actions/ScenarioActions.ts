import { Logger } from "@/utils";
import { ForkId } from "@/types/types";
import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import { CreateAndResolveDisputeResult, HarnessOptions } from "../core/types";

export class ScenarioActions {
    constructor(
        private harness: PeerTestHarness,
        private logger: Logger
    ) {}

    async timeoutSetup(peerCount: number = 3, transitionCount: number = 0) {
        await this.harness.lifecycle.start(peerCount, transitionCount, {
            timeConfig: {
                p2pTime: 1,
                agreementTime: 1,
                chainFallbackTime: 2,
                evidenceTime: 3
            }
        });
    }

    async startChannel(
        peerCount: number,
        transitionCount: number = 0,
        options?: HarnessOptions
    ) {
        await this.harness.lifecycle.start(peerCount, transitionCount, options);
    }

    async fourPeersDisputeResolution(options?: {
        timeConfig?: {
            p2pTime?: number;
            agreementTime?: number;
            chainFallbackTime?: number;
            evidenceTime?: number;
        };
    }) {
        await this.startChannel(4, 2, options);
        await this.harness.assert.sync.peersInSync();
        await this.disputeWithReduction({ maliciousPeerIndex: 2 });
        await this.harness.assert.sync.forkChanged({
            originalForkId: this.harness.context.originalForkId!,
            minHonestPeers: 3
        });
    }

    async fourPeerDisputeResolution(options?: {
        timeConfig?: {
            p2pTime?: number;
            agreementTime?: number;
            chainFallbackTime?: number;
            evidenceTime?: number;
        };
    }) {
        await this.fourPeersDisputeResolution(options);
    }

    async fourPeersDisputeResolutionAndSnapshotUpdate(options?: {
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

    async preDisputeSetup(peerCount: number = 3) {
        await this.timeoutSetup(peerCount);
        await this.harness.assert.sync.peersInSync();
        this.harness.event.resetEventSpies();
        this.harness.contextApi.captureOriginalFork();
    }

    async peerWithUnbroadcastedBlock(peerIndex: number = 1) {
        await this.harness.assert.sync.peersInSync();
        this.harness.event.resetEventSpies();
        this.harness.byzantine.stubBroadcast(peerIndex);
        await this.harness.transition.advanceState({ waitForSync: false });
    }

    async spectatorJoinedAndSynced(
        initialTransitions: number = 3,
        options?: HarnessOptions
    ) {
        await this.startChannel(3, 0, options);
        await this.harness.assert.sync.participantCount({ expectedCount: 3 });
        await this.harness.transition.advanceState({
            count: initialTransitions
        });
        await this.harness.addPeer();
        await this.harness.assert.sync.peersInSync({
            peerIndices: [0, 1, 2, 3]
        });
    }

    async readyForRedispute() {
        await this.startChannel(4, 0, {
            timeConfig: {
                p2pTime: 2,
                agreementTime: 1,
                chainFallbackTime: 2,
                evidenceTime: 4
            }
        });

        await this.harness.byzantine.disconnect(3);
        await this.harness.transition.advanceState({ txFn: (c) => c.add(1) });
        await this.harness.assert.sync.peersInSync({ peerIndices: [0, 1, 2] });
        this.harness.event.resetEventSpies();
    }

    async peer2Isolated() {
        await this.startChannel(3, 0, {
            timeConfig: {
                p2pTime: 1,
                agreementTime: 1,
                chainFallbackTime: 2
            }
        });

        this.harness.byzantine.stubCalldataHandler(2);
        this.harness.contextApi.storeSnapshotCount(2, "before_isolation");
        await this.harness.byzantine.disconnect(2);
        this.harness.event.resetEventSpies();
    }

    async activeChannelWithDispute(options: {
        numPeers: number;
        numBlocks: number;
        byzantinePeer: number;
    }) {
        const { numPeers, numBlocks, byzantinePeer } = options;

        await this.startChannel(numPeers, numBlocks);
        await this.harness.byzantine.submitDoubleSignBlock(byzantinePeer, {
            forkId: this.harness.activeForkId!
        });
        await this.harness.assert.dispute.disputeCommittedByPeers();
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

        const result = await this.harness.dispute.resolveDispute({
            maliciousPeerIndex: options.maliciousPeerIndex,
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
        this.harness.activeForkId = result.newForkId;

        this.logger.debug(
            `Scenario disputeAndResolve completed: maliciousPeer=${options.maliciousPeerIndex}, originalFork=${originalForkId}, newFork=${result.newForkId}`
        );

        return result;
    }
}
