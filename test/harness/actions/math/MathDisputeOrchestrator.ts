import { ForkId } from "@/types/types";

import { DisputeOrchestrator } from "@test/harness/actions/DisputeOrchestrator";
import type { CreateAndResolveDisputeResult } from "@test/harness/core/types";
import type { HarnessControlRpc } from "@test/fixtures/customRpc/harnessControl/HarnessControlRpc";
import { MathPeerTestHarness } from "test-harness";

export class MathDisputeOrchestrator extends DisputeOrchestrator {
    declare public harness: MathPeerTestHarness;

    constructor(
        harness: MathPeerTestHarness,
        logger: MathPeerTestHarness["logger"]
    ) {
        super(harness, logger);
    }

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
     * Drives a second dispute after a prior fork transition and verifies that
     * addresses slashed in the earlier window are finally absent from the
     * successor fork's participants.
     */
    async resolveSuccessorDisputeAndAssertEvicted(options: {
        maliciousPeerIndex: number;
        evictedPeerIndices: number[];
        honestPeerIndices: number[];
        disputesCommittedTimeoutMs?: number;
        forkSettleTimeoutMs?: number;
    }): Promise<CreateAndResolveDisputeResult<HarnessControlRpc>> {
        const forkId = this.harness.activeForkId;
        if (!forkId) throw new Error("Expected an active successor fork");

        this.harness.event.resetEventSpies();
        await this.createInvalidStateTransitionDispute(
            options.maliciousPeerIndex,
            { forkId }
        );
        const result = await this.resolveDisputeWait({
            forkId,
            maliciousPeerIndices: [options.maliciousPeerIndex],
            honestPeerIndices: options.honestPeerIndices,
            disputesCommittedTimeoutMs:
                options.disputesCommittedTimeoutMs ??
                this.harness.event.protocolEventTimeoutMs({
                    withFirstBlockGrace: true
                }),
            forkSettleTimeoutMs:
                options.forkSettleTimeoutMs ??
                this.harness.event.protocolEventTimeoutMs({
                    withFirstBlockGrace: true
                })
        });

        const evictedAddresses = options.evictedPeerIndices.map(
            (index) => this.harness.getPeer(index).address
        );
        for (const peer of result.honestPeers) {
            const participants = await this.harness
                .control(peer)
                .query.getParticipants()
                .request();
            for (const address of evictedAddresses) {
                if (participants.includes(address)) {
                    throw new Error(
                        `Peer ${peer.index}: previously slashed address ${address} still participates on successor fork ${result.newForkId}`
                    );
                }
            }
        }
        return result;
    }
}
