import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import { CreateAndResolveDisputeResult } from "../core/types";
import { Logger } from "@/utils";
import { ForkId } from "@/types/types";
import { ZeroHash } from "ethers";

/**
 * DisputeOrchestrator - High-level dispute resolution workflows
 */
export class DisputeOrchestrator {
    constructor(
        protected harness: PeerTestHarness,
        protected logger: Logger
    ) {}

    /**
     * Waits for dispute commitment and fork reduction, agnostic to how the dispute was created.
     */
    async resolveDisputeWait(
        options: {
            maliciousPeerIndices?: number[];
            forkId?: ForkId;
            honestPeerIndices?: number[];
            disputesCommittedTimeoutMs?: number;
            forkSettleTimeoutMs?: number;
            expectedDisputesCommittedPerPeer?: number;
            disputesCommittedMode?: "exact" | "atLeast";
            assertMaliciousRemoved?: boolean;
            syntheticOnChainParticipants?: number;
        } = {}
    ): Promise<CreateAndResolveDisputeResult> {
        const originalForkId = options.forkId || this.harness.activeForkId!;
        const maliciousPeerIndices = Array.from(
            new Set<number>([
                ...(options.maliciousPeerIndices ?? []),
                ...(this.harness.context.maliciousPeerIndices ?? [])
            ])
        );
        const peersExcludingMaliciousAndLeavers = this.harness
            .getPeersExcludingMaliciousAndLeavers()
            .map((p) => p.index);
        const honestPeerIndices =
            options.honestPeerIndices !== undefined
                ? peersExcludingMaliciousAndLeavers.filter((i) =>
                      options.honestPeerIndices!.includes(i)
                  )
                : peersExcludingMaliciousAndLeavers;
        if (honestPeerIndices.length < 1) {
            throw new Error(
                `Need at least 1 honest peer to resolve dispute (got ${honestPeerIndices.length})`
            );
        }

        const syncPeerIndices = [...honestPeerIndices];

        const disputesCommittedTimeoutMs =
            options.disputesCommittedTimeoutMs ?? 5000;
        const forkSettleTimeoutMs = options.forkSettleTimeoutMs ?? 20000;

        await this.harness.event.waitForEventCounts(
            "onDisputeCommitted",
            syncPeerIndices.map((peerId) => ({
                peerId,
                expectedCount: options.expectedDisputesCommittedPerPeer ?? 1
            })),
            disputesCommittedTimeoutMs,
            { mode: options.disputesCommittedMode ?? "atLeast" }
        );

        await this.harness.assert.sync.forkChangedWait({
            originalForkId,
            excludeForkIds: [originalForkId],
            honestPeerIndices: syncPeerIndices,
            timeoutMs: forkSettleTimeoutMs
        });

        const honestPeers = honestPeerIndices.map((idx) =>
            this.harness.getPeerHandle(idx)
        );
        const newForkId = honestPeers[0]!.forkId;

        if (
            newForkId === undefined ||
            newForkId === originalForkId ||
            newForkId === ZeroHash
        ) {
            throw new Error(
                `Expected new forkId after reduction (got ${newForkId})`
            );
        }

        if (options.assertMaliciousRemoved ?? true) {
            const maliciousAddresses = maliciousPeerIndices.map(
                (i) => this.harness.getPeerHandle(i).address
            );

            const cap =
                honestPeers.length +
                (options.syntheticOnChainParticipants ?? 0);

            const settledPeers = syncPeerIndices
                .map((i) => this.harness.getPeerHandle(i))
                .filter((p) => p.forkId === newForkId);

            for (const peer of settledPeers) {
                const participants = await peer.queryParticipants();
                if (participants.length > cap || participants.length === 0) {
                    throw new Error(
                        `Peer ${peer.index} has unexpected participant count ${participants.length} (expected 1..${cap}) on new fork ${newForkId}`
                    );
                }
                for (const addr of maliciousAddresses) {
                    if (participants.includes(addr)) {
                        throw new Error(
                            `Peer ${peer.index}: evicted address ${addr} still in getParticipants() on new fork ${newForkId}`
                        );
                    }
                }
            }
        }

        this.logger.debug(
            `Resolved dispute: maliciousPeers=${maliciousPeerIndices.join(",")}, originalFork=${originalForkId}, newFork=${newForkId}`
        );

        return {
            originalForkId,
            newForkId,
            maliciousPeerIndices,
            honestPeerIndices,
            honestPeers
        };
    }
}
