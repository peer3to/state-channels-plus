import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import type { HarnessControlRpc } from "@test/fixtures/customRpc/harnessControl/HarnessControlRpc";
import { CreateAndResolveDisputeResult } from "../core/types";
import { Logger } from "@/utils";
import { ForkId } from "@/types/types";
import { ZeroHash } from "ethers";

/**
 * DisputeOrchestrator - High-level dispute resolution workflows
 */
export class DisputeOrchestrator<
    TCustomRpc extends HarnessControlRpc = HarnessControlRpc
> {
    constructor(
        protected harness: PeerTestHarness<TCustomRpc>,
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
    ): Promise<CreateAndResolveDisputeResult<TCustomRpc>> {
        const originalForkId = options.forkId || this.harness.activeForkId!;
        const maliciousPeerIndices = Array.from(
            new Set<number>([
                ...(options.maliciousPeerIndices ?? []),
                ...(this.harness.context.maliciousPeerIndices ?? [])
            ])
        );
        const afkPeerIndices = Array.from(
            new Set<number>(this.harness.context.afkPeerIndices ?? [])
        );
        const activeHonestPeerIndices = this.harness
            .getActiveHonestPeers()
            .map((p) => p.index);
        const honestPeerIndices =
            options.honestPeerIndices !== undefined
                ? activeHonestPeerIndices.filter((i) =>
                      options.honestPeerIndices!.includes(i)
                  )
                : activeHonestPeerIndices;
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
            this.harness.getPeer(idx)
        );
        const newForkId = (
            await this.harness.peerForkIds([honestPeers[0]!])
        )[0];

        if (newForkId === originalForkId || newForkId === ZeroHash) {
            throw new Error(
                `Expected new forkId after reduction (got ${newForkId})`
            );
        }

        if (options.assertMaliciousRemoved ?? true) {
            const maliciousAddresses = maliciousPeerIndices.map(
                (i) => this.harness.getPeer(i).address
            );
            const afkAddresses = afkPeerIndices.map(
                (i) => this.harness.getPeer(i).address
            );
            const retainedAfkCount =
                maliciousPeerIndices.length > 0 ? afkPeerIndices.length : 0;

            const cap =
                honestPeers.length +
                retainedAfkCount +
                (options.syntheticOnChainParticipants ?? 0);

            const candidatePeers = syncPeerIndices.map((i) =>
                this.harness.getPeer(i)
            );
            const candidateForkIds =
                await this.harness.peerForkIds(candidatePeers);
            const settledPeers = candidatePeers.filter(
                (_, idx) => candidateForkIds[idx] === newForkId
            );

            for (const peer of settledPeers) {
                const participants = await this.harness
                    .control(peer)
                    .query.getParticipants()
                    .request();
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
                for (const addr of afkAddresses) {
                    const shouldRemain = maliciousPeerIndices.length > 0;
                    if (participants.includes(addr) !== shouldRemain) {
                        throw new Error(
                            `Peer ${peer.index}: AFK address ${addr} ${shouldRemain ? "missing from" : "still in"} getParticipants() on new fork ${newForkId}`
                        );
                    }
                }
            }
        }

        this.logger.debug(
            `Resolved dispute: maliciousPeers=${maliciousPeerIndices.join(",")}, afkPeers=${afkPeerIndices.join(",")}, originalFork=${originalForkId}, newFork=${newForkId}`
        );

        return {
            originalForkId,
            newForkId,
            maliciousPeerIndices,
            afkPeerIndices,
            honestPeerIndices,
            honestPeers
        };
    }
}
