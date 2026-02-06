import { PeerTestHarness, EventSpies } from "@test/fixtures/PeerTestHarness";
import { Logger } from "@/utils";
import { expect } from "chai";

/**
 * EventActions handles all event spy management and queries.
 * Responsibilities:
 * - Query event call counts and arguments
 * - Wait for specific event count conditions
 * - Reset event spy history
 * - Assert event calls
 */
export class EventActions {
    constructor(
        private harness: PeerTestHarness<any, any>,
        private logger: Logger
    ) {}

    /**
     * Get the number of times an event was called for a peer
     */
    getEventCallCount(peerIndex: number, eventName: keyof EventSpies): number {
        const peer = this.harness.peers[peerIndex];
        if (!peer) throw new Error(`Peer ${peerIndex} not found`);
        const spy = peer.eventSpies[eventName];
        const count = spy ? spy.callCount : 0;
        return count;
    }

    /**
     * Wait for specific event counts across multiple peers
     */
    async waitForEventCounts(
        eventName: keyof EventSpies,
        expectedCounts: Array<{ peerId: number; expectedCount: number }>,
        timeoutMs: number = 10000,
        { mode = "exact" }: { mode?: "exact" | "atLeast" } = { mode: "exact" }
    ): Promise<boolean> {
        const condition = () => {
            for (const { peerId, expectedCount } of expectedCounts) {
                const actualCount = this.getEventCallCount(peerId, eventName);
                if (
                    (mode === "exact" && actualCount !== expectedCount) ||
                    (mode === "atLeast" && actualCount < expectedCount)
                ) {
                    return false;
                }
            }
            return true;
        };

        try {
            await this.harness.eventCountsBarrier.waitFor(condition, {
                timeoutMs,
                timeoutMessage: `${String(eventName)} counts not reached within ${timeoutMs}ms`
            });
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Get arguments from a specific event call
     */
    getEventArgs(
        peerIndex: number,
        eventName: keyof EventSpies,
        callIndex: number = 0
    ): any {
        const peer = this.harness.peers[peerIndex];
        if (!peer) throw new Error(`Peer ${peerIndex} not found`);

        const spy = peer.eventSpies[eventName];
        if (!spy)
            throw new Error(
                `Event ${eventName} spy not found for peer ${peerIndex}`
            );
        if (callIndex >= spy.callCount) {
            throw new Error(
                `Event ${eventName} was only called ${spy.callCount} times, cannot get call ${callIndex}`
            );
        }
        return spy.getCall(callIndex).args;
    }

    /**
     * Assert that an event was called a minimum number of times for a peer
     */
    assertEventCalled(
        peerIndex: number,
        eventName: keyof EventSpies,
        minTimes: number = 1
    ): void {
        const peer = this.harness.peers[peerIndex];
        if (!peer) throw new Error(`Peer ${peerIndex} not found`);

        const spy = peer.eventSpies[eventName];
        if (!spy)
            throw new Error(
                `Event ${eventName} spy not found for peer ${peerIndex}`
            );
        expect(spy.callCount).to.be.at.least(
            minTimes,
            `Event ${eventName} should have been called at least ${minTimes} times for peer ${peerIndex}`
        );
    }

    /**
     * Assert total event calls across all peers
     */
    assertEventHandlerCalledTotalTimes(
        eventName: keyof EventSpies,
        expectedTotalCalls: number
    ): void {
        const totalCalls = this.harness.peers.reduce((sum, peer) => {
            return sum + this.getEventCallCount(peer.index, eventName);
        }, 0);

        expect(totalCalls).to.equal(
            expectedTotalCalls,
            `Expected ${eventName} to be called ${expectedTotalCalls} times total across all peers, but was called ${totalCalls} times`
        );
    }

    /**
     * Reset event spy history for one peer or all peers
     */
    resetEventSpies(peerIndex?: number): void {
        if (peerIndex !== undefined) {
            const peer = this.harness.peers[peerIndex];
            if (!peer) throw new Error(`Peer ${peerIndex} not found`);
            Object.values(peer.eventSpies).forEach((spy) =>
                spy?.resetHistory()
            );
        } else {
            this.harness.peers.forEach((peer) => {
                Object.values(peer.eventSpies).forEach((spy) =>
                    spy?.resetHistory()
                );
            });
        }
    }
}
