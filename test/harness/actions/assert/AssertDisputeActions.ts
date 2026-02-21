import type { ForkId } from "@/types/types";
import type { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import type { EventBarrierCapturedError } from "@/utils/EventBarrier";
import { expect } from "chai";
import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";

export class AssertDisputeActions {
    constructor(private readonly harness: PeerTestHarness) {}

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

    async didNotInitiateDispute(options: { peers: number[] }): Promise<void> {
        const peers = this.harness.getFilteredPeers(options.peers);

        for (const peer of peers) {
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

    async latestDisputeFraudProofStored(options?: {
        dispute?: DisputeStruct;
        timeoutMs?: number;
        peerIndices?: number[];
    }): Promise<void> {
        const dispute =
            options?.dispute || this.harness.context.lastTamperedDispute;
        if (!dispute) {
            throw new Error(
                "No dispute provided and no lastTamperedDispute in context"
            );
        }
        await this.assertDisputeFraudProofStored({
            dispute,
            timeoutMs: options?.timeoutMs,
            peerIndices: options?.peerIndices
        });
    }

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

        if (condition()) {
            return;
        }

        try {
            await this.harness.eventCountsBarrier.waitFor(condition, {
                timeoutMs,
                timeoutMessage: `Dispute fraud proof was not stored on all peers within ${timeoutMs}ms`
            });
        } catch (error) {
            const barrierError = error as EventBarrierCapturedError;
            this.harness.logger.error(
                "assertDisputeFraudProofStored waitFor failed",
                {
                    error,
                    capturedBarrierStack: barrierError.capturedBarrierStack,
                    timeoutMs,
                    peerIndices: peers.map((peer) => peer.index)
                }
            );
            const wrappedError = new Error(
                `Dispute fraud proof was not stored on all peers within ${timeoutMs}ms`
            ) as EventBarrierCapturedError;
            wrappedError.capturedBarrierStack =
                barrierError.capturedBarrierStack;
            throw wrappedError;
        }
    }

    async fraudProofStoredForTamperedDispute(
        detectingPeerIndex: number,
        options?: { timeoutMs?: number }
    ): Promise<void> {
        const dispute = this.harness.context.lastTamperedDispute;
        if (!dispute) {
            throw new Error("No tampered dispute found in context");
        }

        await this.assertDisputeFraudProofStored({
            dispute,
            timeoutMs: options?.timeoutMs,
            peerIndices: [detectingPeerIndex]
        });
    }

    noDisputes(): void {
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

    timeoutIsForced(options: {
        participant: number;
        peerToCheck?: number;
        forkId?: ForkId;
    }): void {
        const forkId = options.forkId || this.harness.activeForkId;
        if (!forkId) {
            throw new Error("No active fork ID");
        }

        const { participant, peerToCheck = 0 } = options;

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
}
