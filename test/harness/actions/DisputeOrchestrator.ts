import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import { CreateAndResolveDisputeResult } from "../core/types";
import { Logger } from "@/utils";
import { ForkId } from "@/types/types";
import { ZeroHash } from "ethers";
import { expect } from "chai";

/**
 * DisputeOrchestrator - High-level dispute resolution workflows
 *
 * Orchestrates complex multi-step dispute scenarios:
 * - Create dispute
 * - Wait for on-chain commitment
 * - Wait for fork resolution
 * - Verify honest peer convergence
 *
 * These are test helpers, not core harness functionality.
 */
export class DisputeOrchestrator {
    constructor(
        private harness: PeerTestHarness,
        private logger: Logger
    ) {}

    /**
     * Creates an invalid state transition dispute by broadcasting an invalid block.
     */
    async createInvalidStateTransitionDispute(
        maliciousPeerIndex: number,
        options?: {
            forkId?: ForkId;
            resetEventSpies?: boolean;
        }
    ): Promise<void> {
        if (options?.resetEventSpies) {
            this.harness.event.resetEventSpies();
        }

        await this.harness.byzantine.submitInvalidStateTransitionBlock(
            maliciousPeerIndex,
            {
                forkId: options?.forkId
            }
        );
    }

    /**
     * Waits for dispute commitment and fork reduction, agnostic to how the dispute was created.
     */
    async resolveDispute(options: {
        maliciousPeerIndex: number;
        forkId?: ForkId;
        honestPeerIndices?: number[];
        disputesCommittedTimeoutMs?: number;
        forkSettleTimeoutMs?: number;
        expectedDisputesCommittedPerPeer?: number;
        disputesCommittedMode?: "exact" | "atLeast";
        assertMaliciousRemoved?: boolean;
    }): Promise<CreateAndResolveDisputeResult> {
        const originalForkId = options.forkId || this.harness.activeForkId!;
        const maliciousPeerIndex = options.maliciousPeerIndex;
        const honestPeerIndices =
            options.honestPeerIndices ??
            (await this.getParticipantPeerIndices()).filter(
                (i) => i !== maliciousPeerIndex
            );

        if (honestPeerIndices.length < 1) {
            throw new Error(
                `Need at least 1 honest peer to resolve dispute (got ${honestPeerIndices.length})`
            );
        }

        const disputesCommittedTimeoutMs =
            options.disputesCommittedTimeoutMs ?? 5000;

        const expectedDisputesCommittedPerPeer =
            options.expectedDisputesCommittedPerPeer ?? 1;

        await this.harness.event.waitForEventCounts(
            "onDisputeCommitted",
            honestPeerIndices.map((peerId) => ({
                peerId,
                expectedCount: expectedDisputesCommittedPerPeer
            })),
            disputesCommittedTimeoutMs,
            { mode: options.disputesCommittedMode ?? "atLeast" }
        );

        await this.harness.assert.sync.forkChangedWait({
            originalForkId,
            excludeForkIds: [originalForkId],
            timeoutMs: options.forkSettleTimeoutMs ?? 10000
        });

        const honestPeers = honestPeerIndices.map((idx) =>
            this.harness.getPeer(idx)
        );
        const newForkId = honestPeers[0]!.stateManager.forkId;

        if (newForkId === originalForkId || newForkId === ZeroHash) {
            throw new Error(
                `Expected new forkId after reduction (got ${newForkId})`
            );
        }

        if (options.assertMaliciousRemoved ?? true) {
            const maliciousAddress =
                this.harness.getPeer(maliciousPeerIndex).address;
            for (const peer of honestPeers) {
                const participants =
                    await peer.stateManager.diamondStateMachine.getParticipants();
                expect(participants).to.have.lengthOf(honestPeers.length);
                expect(participants).to.not.include(maliciousAddress);
            }
        }

        this.logger.debug(
            `Resolved dispute: maliciousPeer=${maliciousPeerIndex}, originalFork=${originalForkId}, newFork=${newForkId}`
        );

        return {
            originalForkId,
            newForkId,
            maliciousPeerIndex,
            honestPeerIndices,
            honestPeers
        };
    }

    private async getParticipantPeerIndices(
        providerPeerIndex: number = 0
    ): Promise<number[]> {
        const provider = this.harness.getPeer(providerPeerIndex);
        const participants =
            await provider.stateManager.diamondStateMachine.getParticipants();
        const participantSet = new Set(
            participants.map((a) => a.toString().toLowerCase())
        );

        return this.harness.peers
            .map((p) => p.index)
            .filter((idx) =>
                participantSet.has(
                    this.harness.getPeer(idx).address.toLowerCase()
                )
            );
    }
}
