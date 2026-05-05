import { Logger } from "@/utils";
import { ForkId } from "@/types/types";
import {
    CreateAndResolveDisputeResult,
    HarnessOptions
} from "@test/harness/core/types";
import { ScenarioActions } from "@test/harness/actions/ScenarioActions";
import { MathPeerTestHarness } from "test-harness";

export class MathScenarioActions extends ScenarioActions {
    declare public harness: MathPeerTestHarness;

    constructor(harness: MathPeerTestHarness, logger: Logger) {
        super(harness, logger);
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

    async fourPeersDisputeResolution(options?: {
        timeConfig?: {
            p2pTime?: number;
            agreementTime?: number;
            chainFallbackTime?: number;
            evidenceTime?: number;
        };
    }): Promise<CreateAndResolveDisputeResult> {
        await this.harness.lifecycle.start(4, 2, options);
        await this.harness.assert.sync.peersInSyncWait();
        return this.disputeWithReduction({ maliciousPeerIndex: 2 });
    }

    async fourPeersDisputeResolutionAndSnapshotUpdateDetached(options?: {
        timeConfig?: {
            p2pTime?: number;
            agreementTime?: number;
            chainFallbackTime?: number;
            evidenceTime?: number;
        };
    }) {
        const { newForkId } = await this.fourPeersDisputeResolution(options);
        this.harness.assert.snapshot.onChainSnapshotChangedDetached({
            expectedForkId: newForkId as string
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
        const { newForkId } = await this.fourPeersDisputeResolution(options);
        await this.harness.assert.snapshot.onChainSnapshotChangedWait({
            expectedForkId: newForkId as string
        });
    }

    async preDisputeSetup(options?: {
        peerCount?: number;
        timeConfig?: {
            p2pTime?: number;
            agreementTime?: number;
            chainFallbackTime?: number;
            evidenceTime?: number;
        };
    }) {
        await this.harness.lifecycle.timeoutSetup(
            options?.peerCount ?? 3,
            2,
            options
        );
        await this.harness.assert.sync.peersInSyncWait();
        this.harness.event.resetEventSpies();
        this.harness.contextApi.captureOriginalFork();
    }

    async preDisputeSetupCalldataPath(options?: {
        timeConfig?: {
            p2pTime?: number;
            agreementTime?: number;
            chainFallbackTime?: number;
            evidenceTime?: number;
        };
    }) {
        const timeConfig = {
            evidenceTime: 6,
            ...options?.timeConfig
        };

        await this.preDisputeSetup({ peerCount: 4, timeConfig });
        await this.harness.join.forceInboundJoinWait();

        this.harness.contextApi.captureOriginalFork();
        this.harness.event.resetEventSpies();
    }

    async junkDataMilestoneMultiLeaveSetup(options?: {
        timeConfig?: {
            p2pTime?: number;
            agreementTime?: number;
            chainFallbackTime?: number;
            evidenceTime?: number;
        };
    }) {
        const timeConfig = {
            p2pTime: 1,
            agreementTime: 6,
            chainFallbackTime: 2,
            evidenceTime: 6,
            ...options?.timeConfig
        };

        await this.harness.lifecycle.timeoutSetup(5, 2, { timeConfig });

        const firstLeaver =
            await this.harness.transition.participantLeaveDetached({
                waitForPeers: [0, 1, 3, 4]
            });

        await this.harness.transition.advanceState({
            waitForPeers: [0, 1, 3, 4],
            count: 1
        });

        const secondLeaver =
            await this.harness.transition.participantLeaveDetached({
                waitForPeers: [0, 1, 3]
            });

        this.harness.context.leftChannelPeerIndices = [
            firstLeaver,
            secondLeaver
        ];

        await this.harness.transition.advanceState({
            waitForPeers: [0, 1, 3],
            count: 1
        });

        this.harness.event.resetEventSpies();
        this.harness.contextApi.captureOriginalFork();
    }

    async junkDataMilestoneM1InboundThenM2Setup(options?: {
        timeConfig?: {
            p2pTime?: number;
            agreementTime?: number;
            chainFallbackTime?: number;
            evidenceTime?: number;
        };
    }): Promise<{ pendingJoin: string }> {
        const timeConfig = {
            p2pTime: 1,
            agreementTime: 6,
            chainFallbackTime: 2,
            evidenceTime: 6,
            ...options?.timeConfig
        };

        await this.harness.lifecycle.timeoutSetup(5, 2, { timeConfig });

        const firstLeaver =
            await this.harness.transition.participantLeaveDetached({
                waitForPeers: [0, 1, 3, 4]
            });

        await this.harness.transition.advanceState({
            waitForPeers: [0, 1, 3, 4],
            count: 1
        });

        const { participant: pendingJoin } =
            await this.harness.join.forceInboundJoinWait();

        const secondLeaver =
            await this.harness.transition.participantLeaveDetached({
                waitForPeers: [0, 1, 3],
                waitForFinalization: false
            });

        this.harness.context.leftChannelPeerIndices = [
            firstLeaver,
            secondLeaver
        ];

        this.harness.event.resetEventSpies();
        this.harness.contextApi.captureOriginalFork();

        return { pendingJoin };
    }

    async preDisputeSetupDisconnectedPeer(options?: {
        timeConfig?: {
            p2pTime?: number;
            agreementTime?: number;
            chainFallbackTime?: number;
            evidenceTime?: number;
        };
        count?: number;
        disconnectedPeerIndex?: number;
    }) {
        const timeConfig = {
            evidenceTime: 6,
            ...options?.timeConfig
        };
        const count = options?.count ?? 2;
        const disconnectedPeerIndex = options?.disconnectedPeerIndex ?? 2;
        await this.harness.lifecycle.timeoutSetup(4, 0, { timeConfig });
        await this.harness.network.disconnectPeer(disconnectedPeerIndex);
        const remainingPeerIndices = [0, 1, 2, 3].filter(
            (i) => i !== disconnectedPeerIndex
        );
        await this.harness.transition.advanceState({
            waitForPeers: remainingPeerIndices,
            count
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

    async syncSpectatorAndPrepareJoin(initialTransitions: number = 4) {
        const h = this.harness;
        await h.lifecycle.start(3, initialTransitions, {
            timeConfig: {
                p2pTime: 5,
                agreementTime: 4,
                chainFallbackTime: 2,
                evidenceTime: 4
            }
        });

        const joiner = await h.join.addSpectatorWait();
        await h.assert.sync.peersInSyncWait();

        const stateSnapshot = await h.channelManager.getStateSnapshot(
            h.channelId
        );
        const confirmation = await h.join.buildJoinChannelConfirmation({
            joiner,
            channelId: h.channelId,
            existingParticipantSigners: h.peers
                .filter((p) => p.index !== joiner.index)
                .map((p) => p.signer)
        });

        return { joiner, stateSnapshot, confirmation };
    }

    async spectatorJoinedAndSynced(
        initialTransitions: number = 3,
        options?: HarnessOptions
    ) {
        await this.harness.lifecycle.start(3, 0, options);
        await this.harness.assert.sync.participantCount({
            expectedCount: 3
        });
        await this.harness.transition.advanceState({
            count: initialTransitions
        });
        await this.harness.event.resetEventSpies();
        await this.harness.join.addSpectatorWait();
        await this.harness.assert.sync.peersInSyncWait({
            peerIndices: [0, 1, 2, 3]
        });
    }

    async readyForRedispute() {
        await this.harness.lifecycle.start(4, 0);

        await this.harness.byzantine.disconnect(3);
        await this.harness.transition.increment(1);
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
}
