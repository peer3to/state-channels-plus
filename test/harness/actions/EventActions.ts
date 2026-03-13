import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import { EventSpies } from "../core/types";
import { Logger } from "@/utils";

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
        const peer = this.harness.getPeer(peerIndex);
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

        await this.harness.eventCountsBarrier.waitFor(condition, {
            timeoutMs,
            timeoutMessageFn: () => {
                let actualCounts: Array<{
                    peerId: number;
                    actualCount: number;
                }> = [];
                for (const { peerId, expectedCount } of expectedCounts) {
                    const actualCount = this.getEventCallCount(
                        peerId,
                        eventName
                    );
                    actualCounts.push({ peerId, actualCount });
                }
                return `${String(eventName)} counts not reached within ${timeoutMs}ms, expected: ${JSON.stringify(expectedCounts)}, actual: ${JSON.stringify(actualCounts)}`;
            }
        });
        return true;
    }

    /**
     * Reset event spy history for one peer or all peers
     */
    resetEventSpies(peerIndex?: number): void {
        const peers = this.harness.getFilteredPeers(
            peerIndex !== undefined ? [peerIndex] : undefined
        );

        peers.forEach((peer) => {
            const eventNames = Object.keys(peer.eventSpies) as Array<
                keyof EventSpies
            >;

            const eventCounts = eventNames.map((eventName) => ({
                eventName: String(eventName),
                count: peer.eventSpies[eventName]?.callCount ?? 0
            }));

            const nonZeroEventCounts = eventCounts.filter(
                ({ count }) => count > 0
            );

            peer.logger.verbose(
                `resetEventSpies - peer ${peer.index} current event counts`,
                {
                    peerIndex: peer.index,
                    eventCounts: nonZeroEventCounts
                }
            );

            eventNames.forEach((eventName) => {
                peer.eventSpies[eventName]?.resetHistory();
            });
        });
    }

    async waitUntilEventOccurs(
        eventName: keyof EventSpies,
        timeoutMs: number = 5000,
        peerIndices?: number[]
    ): Promise<void> {
        const peers = this.harness.getFilteredOrHonestPeers(peerIndices);
        const condition = () => {
            return peers.every(
                (peer) => this.getEventCallCount(peer.index, eventName) > 0
            );
        };

        await this.harness.eventCountsBarrier.waitFor(condition, {
            timeoutMs,
            timeoutMessage: `Event ${String(eventName)} did not occur within ${timeoutMs}ms`
        });
    }

    async waitForAllPeers(
        eventName: keyof EventSpies,
        expectedCountPerPeer: number,
        options?: { timeoutMs?: number; mode?: "exact" | "atLeast" }
    ): Promise<void> {
        const expectedCounts = this.harness.peers.map((peer) => ({
            peerId: peer.index,
            expectedCount: expectedCountPerPeer
        }));

        await this.waitForEventCounts(
            eventName,
            expectedCounts,
            options?.timeoutMs,
            { mode: options?.mode }
        );
    }

    async waitForPeers(
        eventName: keyof EventSpies,
        peerIds: number[],
        expectedCountPerPeer: number,
        options?: { timeoutMs?: number; mode?: "exact" | "atLeast" }
    ): Promise<void> {
        const expectedCounts = peerIds.map((peerId) => ({
            peerId,
            expectedCount: expectedCountPerPeer
        }));

        await this.waitForEventCounts(
            eventName,
            expectedCounts,
            options?.timeoutMs,
            { mode: options?.mode }
        );
    }

    async waitForPeerDisputes(
        peerIndex: number,
        minCount: number,
        options?: { timeoutMs?: number }
    ): Promise<void> {
        const { timeoutMs = 10000 } = options || {};
        const condition = () => {
            const count = this.getEventCallCount(
                peerIndex,
                "onInitiatingDispute"
            );
            return count >= minCount;
        };

        await this.harness.eventCountsBarrier.waitFor(condition, {
            timeoutMs,
            timeoutMessage: `Peer ${peerIndex} did not initiate ${minCount} disputes within ${timeoutMs}ms`
        });
    }

    async waitForDisputeFromAnyPeer(
        peerIndices: number[],
        options?: { timeoutMs?: number }
    ): Promise<void> {
        const { timeoutMs = 10000 } = options || {};
        const condition = () => {
            for (const peerIndex of peerIndices) {
                if (
                    this.getEventCallCount(peerIndex, "onInitiatingDispute") > 0
                ) {
                    return true;
                }
            }
            return false;
        };

        await this.harness.eventCountsBarrier.waitFor(condition, {
            timeoutMs,
            timeoutMessage: `None of peers ${peerIndices.join(", ")} initiated a dispute within ${timeoutMs}ms`
        });
    }
}
