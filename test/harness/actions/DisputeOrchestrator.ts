import { PeerTestHarness, TestPeer } from "@test/fixtures/PeerTestHarness";
import { Logger, SignatureUtils } from "@/utils";
import { ForkId } from "@/types/types";

import { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import DisputeManager, {
    ConstructDisputeResult
} from "@/disputeManager/DisputeManager";

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
        private harness: PeerTestHarness<any, any>,
        private logger: Logger
    ) {}

    /**
     * Build and post a tampered dispute from a peer (used to exercise DisputeValidationService rejection paths).
     * Caller is responsible for providing the tamper function that mutates the dispute or confirmation.
     */
    async postTamperedDispute(
        authorPeerIndex: number,
        tamper: (dispute: any, confirmation: any) => void,
        forkId?: ForkId
    ): Promise<{ dispute: any; disputeConfirmation: any }> {
        const peer = this.harness.getPeer(authorPeerIndex);
        const targetForkId = forkId || this.harness.activeForkId!;

        const { dispute, disputeConfirmation } =
            await peer.stateManager.disputeManager.constructDispute(
                targetForkId
            );

        // Apply tampering (e.g., wrong auditingDataHash, bogus timeout participant, etc.)
        tamper(dispute, disputeConfirmation);

        // Re-sign the tampered dispute as the author (threshold is not enforced here; we only need author sig)
        const tamperedSig = await SignatureUtils.signDispute(
            dispute,
            peer.signer
        );
        disputeConfirmation.signedDispute = {
            encodedDispute: tamperedSig.encoded,
            signature: tamperedSig.signature as BytesLike
        };
        disputeConfirmation.signatures = [];

        this.logger.debug(
            `Peer ${authorPeerIndex} submitting tampered dispute for fork ${targetForkId}`
        );
        const txResp = await this.harness.channelManager
            .connect(peer.signer)
            .uploadDispute(disputeConfirmation);
        await txResp.wait();

        return { dispute, disputeConfirmation };
    }

    /**
     * Wraps a peer's constructDispute method with a tampering function.
     * Returns a restore function and a promise that resolves with the tampered dispute.
     */
    withConstructDisputeTampering(
        peerOrIndex: number | TestPeer<any, any>,
        tamper: (
            result: ConstructDisputeResult
        ) => Promise<ConstructDisputeResult>
    ): {
        restore: () => void;
        dispute: Promise<DisputeStruct>;
    } {
        let disputeResolver!: (dispute: DisputeStruct) => void;
        const disputePromise = new Promise<DisputeStruct>((resolve) => {
            disputeResolver = resolve;
        });

        const peer =
            typeof peerOrIndex === "number"
                ? this.harness.getPeer(peerOrIndex)
                : peerOrIndex;

        const disputeManager: DisputeManager = peer.stateManager.disputeManager;
        const originalConstructDispute =
            disputeManager.constructDispute.bind(disputeManager);

        disputeManager.constructDispute = async (targetForkId: ForkId) => {
            const res = await originalConstructDispute(targetForkId);
            const tamperedRes = await tamper(res);
            disputeResolver(tamperedRes.dispute);
            return tamperedRes;
        };

        return {
            restore: () => {
                disputeManager.constructDispute = originalConstructDispute;
            },
            dispute: disputePromise
        };
    }
}
