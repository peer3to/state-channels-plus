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
        // #region agent log
        fetch(
            "http://127.0.0.1:7243/ingest/f9b76b10-324c-4d55-bfc2-8a7f8284883e",
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    location: "EventActions.ts:28",
                    message: "getEventCallCount",
                    data: { peerIndex, eventName, count },
                    timestamp: Date.now(),
                    sessionId: "debug-session",
                    hypothesisId: "H3"
                })
            }
        ).catch(() => {});
        // #endregion
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
            // #region agent log
            fetch(
                "http://127.0.0.1:7243/ingest/f9b76b10-324c-4d55-bfc2-8a7f8284883e",
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        location: "EventActions.ts:138",
                        message: "resetEventSpies: single peer",
                        data: { peerIndex },
                        timestamp: Date.now(),
                        sessionId: "debug-session",
                        hypothesisId: "H4"
                    })
                }
            ).catch(() => {});
            // #endregion
            Object.values(peer.eventSpies).forEach((spy) =>
                spy?.resetHistory()
            );
        } else {
            // #region agent log
            fetch(
                "http://127.0.0.1:7243/ingest/f9b76b10-324c-4d55-bfc2-8a7f8284883e",
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        location: "EventActions.ts:147",
                        message: "resetEventSpies: all peers",
                        data: { peerCount: this.harness.peers.length },
                        timestamp: Date.now(),
                        sessionId: "debug-session",
                        hypothesisId: "H4"
                    })
                }
            ).catch(() => {});
            // #endregion
            this.harness.peers.forEach((peer) => {
                Object.values(peer.eventSpies).forEach((spy) =>
                    spy?.resetHistory()
                );
            });
        }
    }
}
