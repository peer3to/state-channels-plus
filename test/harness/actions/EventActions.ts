import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import type { HarnessControlRpc } from "@test/fixtures/customRpc/harnessControl/HarnessControlRpc";
import { EventSpies } from "../core/types";
import { Logger } from "@/utils";
import { Status } from "@/types";
import { Hash } from "@/types/types";

/**
 * EventActions handles all event spy management and queries.
 * Responsibilities:
 * - Query event call counts and arguments
 * - Wait for specific event count conditions
 * - Reset event spy history
 * - Assert event calls
 */
export class EventActions<
    TCustomRpc extends HarnessControlRpc = HarnessControlRpc
> {
    constructor(
        private harness: PeerTestHarness<TCustomRpc>,
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

    async waitForBlockConfirmationProcessed(options: {
        peerIndex: number;
        blockHash: Hash;
        keepConnection?: boolean;
        timeoutMs?: number;
    }): Promise<void> {
        const {
            peerIndex,
            blockHash,
            keepConnection,
            timeoutMs = 5000
        } = options;
        const peer = this.harness.getPeer(peerIndex);

        await this.harness.eventCountsBarrier.waitFor(
            () => {
                return (
                    peer.eventSpies.onBlockConfirmationProcessed
                        ?.getCalls()
                        .some((call) => {
                            const [
                                processedBlockHash,
                                processedKeepConnection
                            ] = call.args;
                            return (
                                processedBlockHash === blockHash &&
                                (keepConnection === undefined ||
                                    processedKeepConnection === keepConnection)
                            );
                        }) ?? false
                );
            },
            {
                timeoutMs,
                timeoutMessage: `Block confirmation ${blockHash} was not processed by peer ${peerIndex} within ${timeoutMs}ms`
            }
        );
    }

    async waitUntilPeerStatus(
        peerIndex: number,
        expectedStatus: Status,
        options?: { timeoutMs?: number; timeoutMessage?: string }
    ): Promise<void> {
        const peer = this.harness.getPeer(peerIndex);
        if (!peer) {
            throw new Error(`Peer ${peerIndex} not found`);
        }
        const { timeoutMs = 15000, timeoutMessage } = options ?? {};
        const statusName = Status[expectedStatus] ?? String(expectedStatus);
        await this.harness.eventCountsBarrier.waitFor(
            async () =>
                (await this.harness
                    .control(peer)
                    .query.getStatus()
                    .request()) === expectedStatus,
            {
                timeoutMs,
                timeoutMessage:
                    timeoutMessage ??
                    `Peer ${peerIndex} did not reach ${statusName} within ${timeoutMs}ms`
            }
        );
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

    async waitWhileEventCountsStayAtMost(
        eventName: keyof EventSpies,
        peerIds: number[],
        options: { durationMs: number; maxCount?: number }
    ): Promise<void> {
        const maxCount = options.maxCount ?? 0;
        const { durationMs } = options;
        const endAt = Date.now() + durationMs;

        const deadlineTimer = setTimeout(
            () => void this.harness.eventCountsBarrier.signal(),
            durationMs
        );

        try {
            await this.harness.eventCountsBarrier.waitFor(
                () => {
                    for (const peerId of peerIds) {
                        const c = this.getEventCallCount(peerId, eventName);
                        if (c > maxCount) {
                            throw new Error(
                                `peer ${peerId} ${String(eventName)} count ${c} > ${maxCount}`
                            );
                        }
                    }
                    return Date.now() >= endAt;
                },
                {
                    timeoutMs: durationMs + 500,
                    timeoutMessageFn: () =>
                        `Within ${durationMs}ms, ${String(eventName)} for peers [${peerIds.join(", ")}] did not stay at <= ${maxCount}`
                }
            );
        } finally {
            clearTimeout(deadlineTimer);
        }
    }
}
