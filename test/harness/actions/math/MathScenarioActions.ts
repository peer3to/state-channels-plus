// @spec-test-coverage-ignore: shared math scenario setup exercised by owning mapped test declarations
import { Logger, sleep } from "@/utils";
import { ForkId, Hash } from "@/types/types";
import { Status, TimeConfig } from "@/types";
import {
    CreateAndResolveDisputeResult,
    HarnessOptions,
    TestPeer
} from "@test/harness/core/types";
import { ScenarioActions } from "@test/harness/actions/ScenarioActions";
import { MathPeerTestHarness } from "test-harness";
import type { MathStateMachine } from "@typechain-types";
import type { HarnessControlRpc } from "@test/fixtures/customRpc/harnessControl/HarnessControlRpc";

type MathTestPeer = TestPeer<HarnessControlRpc, MathStateMachine>;

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
            maliciousPeerIndex: options.maliciousPeerIndex
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
        const maliciousPeerIndex = (
            await this.harness.query.getNextPeerToWrite()
        ).index;
        return this.disputeWithReduction({ maliciousPeerIndex });
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
        this.harness.assert.snapshot.localSnapshotsChangedDetached({
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
        await this.harness.assert.snapshot.localSnapshotsChangedWait({
            expectedForkId: newForkId as string
        });
    }

    async preDisputeSetup(options?: {
        peerCount?: number;
        transitionCount?: number;
        timeConfig?: {
            p2pTime?: number;
            agreementTime?: number;
            chainFallbackTime?: number;
            evidenceTime?: number;
        };
    }) {
        await this.harness.lifecycle.timeoutSetup(
            options?.peerCount ?? 3,
            options?.transitionCount ?? 2,
            options
        );
        await this.harness.assert.sync.peersInSyncWait();
        this.harness.event.resetEventSpies();
        this.harness.contextApi.captureOriginalFork();
    }

    /**
     * A committed spam dispute (internally valid, no enforcement basis) that
     * every peer audit-failed, with every peer's `killDispute` suppressed while
     * it happened. `killerIndex` therefore holds a real dispute fraud proof
     * against a still-live kill window, and its `killDispute` is restored so a
     * test can drive the kill itself.
     */
    async stageUnkilledSpamDispute(options?: {
        killerIndex?: number;
        spammerIndex?: number;
        addSpectatorBeforeDispute?: boolean;
        timeConfig?: {
            p2pTime?: number;
            agreementTime?: number;
            chainFallbackTime?: number;
            evidenceTime?: number;
        };
    }): Promise<{
        forkId: ForkId;
        spammer: MathTestPeer;
        killer: MathTestPeer;
        spectator: TestPeer<HarnessControlRpc> | undefined;
    }> {
        const killerIndex = options?.killerIndex ?? 0;
        const spammerIndex = options?.spammerIndex ?? 1;
        await this.preDisputeSetup({
            timeConfig: { evidenceTime: 12, ...options?.timeConfig }
        });
        const spectator = options?.addSpectatorBeforeDispute
            ? await this.harness.join.addSpectatorWait()
            : undefined;
        const forkId = this.harness.activeForkId!;

        const kills = await Promise.all(
            this.harness.peers.map((peer) =>
                this.harness.rpcStub.suppressDisputeKill(peer.index)
            )
        );
        await this.harness.tamper.postTamperedDispute(
            spammerIndex,
            (dispute) => {
                dispute.input.timeout.participant =
                    "0x0000000000000000000000000000000000000000";
                dispute.input.onChainSlashes = [];
                dispute.input.selfRemoval = false;
            }
        );
        // the skipped kill is the moment the killer stored its fraud proof
        await kills[killerIndex].waitUntilSkipped();
        await kills[killerIndex].restore();

        return {
            forkId,
            spammer: this.harness.getPeer(spammerIndex),
            killer: this.harness.getPeer(killerIndex),
            spectator
        };
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
            evidenceTime: 12,
            ...options?.timeConfig
        };

        await this.preDisputeSetup({
            peerCount: 4,
            transitionCount: 0,
            timeConfig
        });
        const forceJoin = await this.harness.join.prepareForceInboundJoinWait();
        await this.harness.transition.advanceState({ count: 2 });
        await this.harness.join.submitPreparedForceInboundJoinWait(forceJoin);

        this.harness.contextApi.captureOriginalFork();
        this.harness.event.resetEventSpies();
    }

    async setupTwoLeaversAcrossMilestones(options?: {
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
            evidenceTime: 12,
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

    async preDisputeSetupDisconnectedPeer(options?: {
        timeConfig?: {
            p2pTime?: number;
            agreementTime?: number;
            chainFallbackTime?: number;
            evidenceTime?: number;
        };
        stateTransitionCount?: number;
        disconnectedPeerIndex?: number;
    }) {
        const timeConfig = {
            evidenceTime: 12,
            ...options?.timeConfig
        };
        const stateTransitionCount = options?.stateTransitionCount ?? 2;
        const disconnectedPeerIndex = options?.disconnectedPeerIndex ?? 2;
        await this.harness.lifecycle.timeoutSetup(4, 0, { timeConfig });
        await this.harness.network.disconnectPeer(disconnectedPeerIndex);
        const remainingPeerIndices = [0, 1, 2, 3].filter(
            (i) => i !== disconnectedPeerIndex
        );
        await this.harness.transition.advanceState({
            waitForPeers: remainingPeerIndices,
            count: stateTransitionCount
        });

        this.harness.event.resetEventSpies();
        this.harness.contextApi.captureOriginalFork();
    }

    async peerWithUnbroadcastedBlock(peerIndex: number = 1) {
        await this.harness.assert.sync.peersInSyncWait();
        this.harness.event.resetEventSpies();
        await this.harness.byzantine.stubBroadcast(peerIndex);
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
        const preparedJoin = await h.join.buildJoinChannelConfirmation({
            joiner,
            channelId: h.channelId
        });

        return { joiner, stateSnapshot, ...preparedJoin };
    }
    async spectatorPromotedViaJoinChannelWait(options?: {
        initialPeers?: number;
        initialTransitions?: number;
        postPromotionTransitions?: number;
        timeConfig?: HarnessOptions["timeConfig"];
    }): Promise<TestPeer> {
        const initialPeers = options?.initialPeers ?? 2;
        const initialTransitions = options?.initialTransitions ?? 2;
        const postPromotionTransitions = options?.postPromotionTransitions ?? 2;
        const timeConfig = options?.timeConfig ?? {
            p2pTime: 2,
            agreementTime: 4,
            chainFallbackTime: 4,
            evidenceTime: 6
        };

        await this.harness.lifecycle.start(initialPeers, initialTransitions, {
            timeConfig
        });

        const joiner = await this.harness.join.addSpectatorWait();
        await this.harness.assert.sync.peersInSyncWait();

        await this.harness.join.joinChannelWait({
            joiner
        });
        const joinerStatus = await this.harness
            .control(this.harness.getPeer(joiner.index))
            .query.getStatus()
            .request();
        if (joinerStatus !== Status.PENDING_PARTICIPANT) {
            throw new Error(
                `JOIN_RPC: expected joiner to be PENDING_PARTICIPANT after joinChannel, got ${joinerStatus}`
            );
        }

        await this.harness.transition.advanceState({ count: 2 });
        await this.harness.event.waitUntilPeerStatus(
            joiner.index,
            Status.PARTICIPATING
        );

        if (postPromotionTransitions > 0) {
            await this.harness.transition.advanceState({
                count: postPromotionTransitions
            });
            await this.harness.assert.sync.peersInSyncWait();
        }

        this.harness.assert.dispute.noDisputes();
        this.harness.event.resetEventSpies();
        this.harness.contextApi.captureOriginalFork();

        return joiner;
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

    private async setupChannelWithSpectator(options?: {
        initialPeers?: number;
        initialTransitions?: number;
        timeConfig?: HarnessOptions["timeConfig"];
    }): Promise<{ spectator: TestPeer; initialPeers: number }> {
        const initialPeers = options?.initialPeers ?? 3;
        const initialTransitions = options?.initialTransitions ?? 2;
        const timeConfig = options?.timeConfig ?? {
            p2pTime: 5,
            agreementTime: 4,
            chainFallbackTime: 4,
            evidenceTime: 6
        };
        await this.harness.lifecycle.start(initialPeers, initialTransitions, {
            timeConfig
        });
        // TODO - switch to addSpectatorDetached and drop the inflated timeConfig
        const spectator = await this.harness.join.addSpectatorWait();
        await this.harness.assert.sync.peersInSyncWait();
        return { spectator, initialPeers };
    }

    async spectatorPromotedViaForceInboundWait(options?: {
        initialPeers?: number;
        initialTransitions?: number;
        timeConfig?: HarnessOptions["timeConfig"];
    }): Promise<TestPeer> {
        const { spectator } = await this.setupChannelWithSpectator(options);
        await this.harness.join.forceInboundJoinWait({
            participant: spectator.address
        });
        await this.harness.transition.advanceState({ count: 1 });
        await this.harness.event.waitUntilPeerStatus(
            spectator.index,
            Status.PARTICIPATING
        );
        this.harness.event.resetEventSpies();
        this.harness.contextApi.captureOriginalFork();
        return spectator;
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

    /**
     * Produce a block whose confirmations never reach the other peers, so the
     * next writer's signature is missing from everyone else's copy - the only
     * shape in which the parent's on-chain timestamp still matters to the next
     * block. On-chain posting is suppressed so the parent keeps no on-chain
     * timestamp. Returns an observer holding the parent, the next writer, and
     * a candidate timestamp already past the parent's p2p window.
     */
    async previousBlockUnsignedByNextWriter(options: {
        timeConfig: TimeConfig;
    }) {
        const h = this.harness;
        await h.lifecycle.start(3, 1, { timeConfig: options.timeConfig });
        const forkId = h.activeForkId!;

        const parentAuthorAddress = await h
            .control(h.getPeer(0))
            .query.getNextToWrite()
            .request();
        const parentAuthor = h.peers.find(
            (p) => p.address === parentAuthorAddress
        );
        if (!parentAuthor) {
            throw new Error(`No peer matches writer ${parentAuthorAddress}`);
        }

        // no on-chain posting anywhere -> the parent keeps no on-chain
        // timestamp, and no peer's block reaches the observer through calldata
        await Promise.all(
            h.peers.map((peer) =>
                h
                    .control(peer)
                    .stub.stubSuppressMaybePostBlockOnChain()
                    .request()
            )
        );
        // only the parent author's copy travels -> no other confirmation
        // signature lands on anyone else's copy
        for (const peer of h.peers) {
            if (peer.index !== parentAuthor.index) {
                await h.byzantine.stubBroadcast(peer.index);
            }
        }

        const parentHeight = await h
            .control(parentAuthor)
            .query.getNextBlockHeight(forkId)
            .request();
        await parentAuthor.p2pInstance.p2pContractInstance.add(1);
        await h.syncCoordinator.waitForPeersToSync([parentAuthor], forkId, {
            minHeight: parentHeight,
            waitForFinalization: false
        });
        const parentBundle = await h
            .control(parentAuthor)
            .query.getBlockByHeight(forkId, parentHeight)
            .request();
        if (!parentBundle) {
            throw new Error(`Parent author never stored block ${parentHeight}`);
        }

        const nextWriterAddress = await h
            .control(parentAuthor)
            .query.getNextToWrite()
            .request();
        const author = h.peers.find((p) => p.address === nextWriterAddress);
        if (!author || author.index === parentAuthor.index) {
            throw new Error(`Unexpected next writer ${nextWriterAddress}`);
        }
        const observer = h.peers.find(
            (p) => p.index !== parentAuthor.index && p.index !== author.index
        );
        if (!observer) {
            throw new Error("No third peer available as observer");
        }

        await h.event.waitForBlockConfirmationProcessed({
            peerIndex: observer.index,
            blockHash: parentBundle.hash as Hash
        });
        const previous = await h
            .control(observer)
            .query.getBlockByHeight(forkId, parentHeight)
            .request();
        if (!previous) {
            throw new Error(`Observer never stored block ${parentHeight}`);
        }
        if (previous.confirmationSignerAddresses.includes(author.address)) {
            throw new Error(
                "Next writer signed the parent - its on-chain timestamp would be ignored"
            );
        }
        if (previous.onChainTimestamp !== null) {
            throw new Error("Parent already carries an on-chain timestamp");
        }

        // the observer loses the subscribed delivery, so it only learns the
        // parent's post time by recovering it during validation
        await h.control(observer).stub.stubHoldCalldataPostedEvents().request();

        // leave the parent's p2p window before posting, so its real post time
        // is strictly later than its own timestamp
        await sleep((options.timeConfig.p2pTime + 2) * 1000);
        const { onChainTimestamp: parentPostTimestamp } = await h
            .control(parentAuthor)
            .stub.postBlockCalldataOnChain(previous.encodedSignedBlock)
            .request();
        if (parentPostTimestamp <= previous.timestamp) {
            throw new Error(
                `Parent posted at ${parentPostTimestamp}, not after its own ${previous.timestamp}`
            );
        }
        await h
            .control(observer)
            .stub.waitForHeldCalldataPostedEvent()
            .request();

        return { observer, author, previous, forkId, parentPostTimestamp };
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
