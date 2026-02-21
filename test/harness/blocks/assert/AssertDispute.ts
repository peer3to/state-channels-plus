import { HarnessBlock } from "../HarnessBlock";
import type { EventBarrierCapturedError } from "@/utils/EventBarrier";

export class AssertDispute {
    /**
     * Assert dispute was committed on-chain by all peers
     */
    static disputeCommittedByPeers(options?: {
        expectedCount?: number;
        timeoutMs?: number;
        peersIndices?: number[];
    }) {
        return new HarnessBlock(async (harness) => {
            await harness.assertActions.dispute.disputeCommittedByPeers(
                options
            );
            return harness;
        });
    }

    /**
     * Assert dispute fraud proof was stored for the last tampered dispute
     * Uses event barrier instead of polling
     */
    static latestDisputeFraudProofStored(options?: {
        timeoutMs?: number;
        peers?: number[];
    }) {
        const { timeoutMs = 2000, peers } = options || {};

        return new HarnessBlock(async (harness) => {
            const dispute = harness.context.lastTamperedDispute;
            if (!dispute) {
                throw new Error(
                    "No tampered dispute found. Use Byzantine.tamperedDispute* blocks before this assertion."
                );
            }

            await harness.assertActions.dispute.assertDisputeFraudProofStored({
                dispute,
                timeoutMs,
                peerIndices: peers
            });

            return harness;
        });
    }

    /**
     * Assert fraud proof stored for the tampered dispute from interception
     */
    static fraudProofStoredForTamperedDispute(
        detectingPeerIndex: number,
        options?: { timeoutMs?: number }
    ) {
        const { timeoutMs = 2000 } = options || {};

        return new HarnessBlock(async (harness) => {
            const tamperedDispute = harness.context.lastTamperedDispute;
            if (!tamperedDispute) {
                throw new Error(
                    "No tampered dispute found. Use Byzantine.interceptDisputeConstruction() first."
                );
            }

            const condition = () => {
                const peer = harness.peers[detectingPeerIndex];
                const proof =
                    peer.stateManager.storage.disputeFraudProofs.getDisputeFraudProofForDispute(
                        tamperedDispute
                    );
                return !!proof;
            };

            if (condition()) {
                return harness;
            }

            try {
                await harness.eventCountsBarrier.waitFor(condition, {
                    timeoutMs,
                    timeoutMessage: `Fraud proof not stored within ${timeoutMs}ms`
                });
            } catch (error) {
                const barrierError = error as EventBarrierCapturedError;
                const wrappedError = new Error(
                    `Fraud proof for tampered dispute was not stored by peer ${detectingPeerIndex} within ${timeoutMs}ms`
                ) as EventBarrierCapturedError;
                wrappedError.capturedBarrierStack =
                    barrierError.capturedBarrierStack;
                throw wrappedError;
            }

            return harness;
        });
    }

    /**
     * Assert specific peers initiated disputes
     */
    static disputeInitiatedByPeers(options?: {
        peers?: number[];
        timeoutMs?: number;
    }) {
        return new HarnessBlock(async (harness) => {
            await harness.assertActions.dispute.disputeInitiatedByPeers({
                peersIndices: options?.peers,
                timeoutMs: options?.timeoutMs
            });
            return harness;
        });
    }

    /**
     * Assert specific peers did NOT initiate disputes
     */
    static didNotInitiateDispute(options: { peers: number[] }) {
        return new HarnessBlock(async (harness) => {
            for (const peerId of options.peers) {
                const actualCount = harness.eventActions.getEventCallCount(
                    peerId,
                    "onInitiatingDispute"
                );
                if (actualCount > 0) {
                    throw new Error(
                        `Expected peer ${peerId} to NOT initiate disputes, but initiated ${actualCount}`
                    );
                }
            }
            return harness;
        });
    }

    /**
     * Assert no disputes occurred (neither initiated nor committed)
     */
    static noDisputes() {
        return new HarnessBlock(async (harness) => {
            harness.assertActions.dispute.noDisputes();
            return harness;
        });
    }

    /**
     * Assert timeout is a forced timeout (caused by invalid calldata)
     */
    static timeoutIsForced(options: {
        participant: number;
        peerToCheck?: number;
    }) {
        const { participant, peerToCheck = 0 } = options;
        return new HarnessBlock(async (harness) => {
            const forkId = harness.activeForkId;
            if (!forkId) {
                throw new Error("No active fork ID");
            }

            harness.assertActions.dispute.timeoutIsForced({
                participant,
                peerToCheck,
                forkId
            });

            return harness;
        });
    }
}
