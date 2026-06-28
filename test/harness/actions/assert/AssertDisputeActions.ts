import { expect } from "chai";
import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import type { HarnessControlRpc } from "@test/fixtures/customRpc/harnessControl/HarnessControlRpc";
import type { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { addressesEqual } from "@/utils";

export class AssertDisputeActions<
    TCustomRpc extends HarnessControlRpc = HarnessControlRpc
> {
    constructor(private readonly harness: PeerTestHarness<TCustomRpc>) {}

    async initiatedAndCommitedWait(options?: {
        expectedCount?: number;
        timeoutMs?: number;
        peersIndices?: number[];
        initiatedWithAuditingData?: boolean;
    }) {
        await this.initiatedWait(options);
        await this.committedWait(options);
    }

    async initiatedWait(options?: {
        peersIndices?: number[];
        timeoutMs?: number;
        initiatedWithAuditingData?: boolean;
    }): Promise<void> {
        const {
            peersIndices,
            timeoutMs = 5000,
            initiatedWithAuditingData
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

        if (peersIndices !== undefined) {
            return;
        }

        const nonInitiators = this.harness.peers.filter(
            (peer) => !peers.includes(peer)
        );

        for (const peer of nonInitiators) {
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

    async slashedOnChain(
        address: string,
        msg = `${address} must be on-chain slashed`
    ): Promise<void> {
        const slashed =
            await this.harness.channelManager.getOnChainSlashedParticipants(
                this.harness.channelId
            );
        expect(
            slashed.some((a) => addressesEqual(a, address)),
            msg
        ).to.equal(true);
    }

    async slashedOnChainExactly(addresses: string[]): Promise<void> {
        const slashed =
            await this.harness.channelManager.getOnChainSlashedParticipants(
                this.harness.channelId
            );
        for (const address of addresses) {
            expect(
                slashed.some((a) => addressesEqual(a, address)),
                `${address} must be on-chain slashed`
            ).to.equal(true);
        }
        const unexpected = slashed.filter(
            (a) => !addresses.some((addr) => addressesEqual(a, addr))
        );
        expect(
            unexpected,
            `unexpected on-chain slashes: ${unexpected.join(", ")}`
        ).to.have.length(0);
    }
}
