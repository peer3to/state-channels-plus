import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import { EventSpies } from "../core/types";
import { Logger } from "@/utils";
import type { EventBarrierCapturedError } from "@/utils/EventBarrier";

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
        private harness: PeerTestHarness,
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
        } catch (error) {
            const barrierError = error as EventBarrierCapturedError;
            this.logger.error("waitForEventCounts waitFor failed", {
                error,
                eventName: String(eventName),
                expectedCounts,
                timeoutMs,
                mode,
                capturedBarrierStack: barrierError.capturedBarrierStack
            });
            return false;
        }
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
