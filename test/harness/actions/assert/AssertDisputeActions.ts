import { expect } from "chai";
import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import type { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";

export class AssertDisputeActions {
    constructor(private readonly harness: PeerTestHarness) {}

    async initiatedAndCommitedWait(options?: {
        expectedCount?: number;
        timeoutMs?: number;
        peersIndices?: number[];
        /** If true, skip the check that non-honest peers did not initiate (e.g. when byzantine peer may receive its own broadcast). */
        allowByzantineInitiation?: boolean;
        initiatedWithAuditingData?: boolean;
        nonInitiatorIgnoredIndices?: number[];
    }) {
        await this.initiatedWait(options);
        await this.committedWait(options);
    }

    async initiatedWait(options?: {
        peersIndices?: number[];
        timeoutMs?: number;
        /** If true, skip the check that non-honest peers did not initiate (e.g. when byzantine peer may receive its own broadcast). */
        allowByzantineInitiation?: boolean;
        initiatedWithAuditingData?: boolean;
        /** Peers excluded from the "must not have initiated" assertion (e.g. malicious index, spectators). */
        nonInitiatorIgnoredIndices?: number[];
    }): Promise<void> {
        const {
            peersIndices,
            timeoutMs = 5000,
            allowByzantineInitiation = false,
            initiatedWithAuditingData,
            nonInitiatorIgnoredIndices = []
        } = options || {};

        let peers = this.harness.getFilteredOrHonestPeers(peersIndices);

        const expectedCounts = peers.map((peer) => ({
            peerId: peer.index,
            expectedCount: 1
        }));

        await this.harness.event.waitForEventCounts(
            "onInitiatingDispute",
            expectedCounts,
            timeoutMs
        );

        if (initiatedWithAuditingData !== undefined) {
            for (const peer of peers) {
                const spy = peer.eventSpies.onInitiatingDispute;
                expect(
                    spy?.callCount,
                    `Peer ${peer.index} should have onInitiatingDispute calls`
                ).to.be.at.least(1);
                const dispute = spy!.lastCall.args[1] as DisputeStruct;
                expect(
                    dispute.postedAuditingData,
                    `Peer ${peer.index} dispute postedAuditingData`
                ).to.equal(initiatedWithAuditingData);
            }
        }

        if (allowByzantineInitiation) {
            return;
        }

        const ignoreNonInitiators = new Set(nonInitiatorIgnoredIndices);
        const nonInitiators = this.harness.peers.filter(
            (peer) => !peers.includes(peer)
        );

        for (const peer of nonInitiators) {
            if (ignoreNonInitiators.has(peer.index)) continue;
            const count = this.harness.event.getEventCallCount(
                peer.index,
                "onInitiatingDispute"
            );
            expect(count).to.equal(
                0,
                `Peer ${peer.index} should not have initiated dispute`
            );
        }
    }

    async committedWait(options?: {
        expectedCount?: number;
        timeoutMs?: number;
        peersIndices?: number[];
        /** Default "atLeast" so extra commitments (e.g. from malicious peer) still pass. */
        mode?: "exact" | "atLeast";
    }): Promise<void> {
        const {
            expectedCount = this.harness.getHonestPeers().length,
            timeoutMs = 5000,
            peersIndices,
            mode = "atLeast"
        } = options || {};

        const peers = this.harness.getFilteredOrHonestPeers(peersIndices);

        const expectedCounts = peers.map((p) => ({
            peerId: p.index,
            expectedCount: expectedCount
        }));

        await this.harness.event.waitForEventCounts(
            "onDisputeCommitted",
            expectedCounts,
            timeoutMs,
            { mode }
        );
    }

    async didNotInitiate(options: { peers: number[] }): Promise<void> {
        const peers = this.harness.getFilteredPeers(options.peers);

        for (const peer of peers) {
            const count = this.harness.event.getEventCallCount(
                peer.index,
                "onInitiatingDispute"
            );
            expect(count).to.equal(
                0,
                `Peer ${peer.index} should not have initiated dispute`
            );
        }
    }

    noDisputes(): void {
        const totalInitiated = this.harness.peers.reduce((sum, peer) => {
            return (
                sum +
                this.harness.event.getEventCallCount(
                    peer.index,
                    "onInitiatingDispute"
                )
            );
        }, 0);

        const totalCommitted = this.harness.peers.reduce((sum, peer) => {
            return (
                sum +
                this.harness.event.getEventCallCount(
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
}
