import { HarnessBlock } from "../HarnessBlock";

export class AssertDispute {
    /**
     * Assert dispute was committed on-chain by all peers
     */
    static disputeCommitted(
        expectedCount: number = 2,
        timeoutMs: number = 5000
    ) {
        return new HarnessBlock(async (harness) => {
            await harness.assertActions.disputeCommitted(
                timeoutMs,
                expectedCount
            );
            return harness;
        });
    }

    /**
     * Assert fraud proof was stored for the last tampered dispute
     * Uses event barrier instead of polling
     */
    static fraudProofStored(options?: { timeoutMs?: number }) {
        const { timeoutMs = 2000 } = options || {};

        return new HarnessBlock(async (harness) => {
            const dispute = harness.context.lastTamperedDispute;
            if (!dispute) {
                throw new Error(
                    "No tampered dispute found. Use Byzantine.tamperedDispute* blocks before this assertion."
                );
            }

            await harness.assertActions.assertFraudProofStored({
                dispute,
                timeoutMs
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
            const tamperedDisputePromise =
                harness.context.tamperedDisputePromise;
            if (!tamperedDisputePromise) {
                throw new Error(
                    "No tampered dispute promise found. Use Byzantine.interceptDisputeConstruction() first."
                );
            }

            const tamperedDispute = await tamperedDisputePromise;

            const restore = harness.context.restoreDisputeConstruction;
            if (restore) {
                restore();
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
            } catch {
                throw new Error(
                    `Fraud proof for tampered dispute was not stored by peer ${detectingPeerIndex} within ${timeoutMs}ms`
                );
            }

            return harness;
        });
    }

    /**
     * Assert specific peers initiated disputes
     */
    static disputeInitiatedBy(options: {
        peers: number[];
        timeoutMs?: number;
    }) {
        return new HarnessBlock(async (harness) => {
            await harness.assertActions.disputeInitiatedBy(options);
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
     * Assert all peers committed the dispute
     */
    static disputeCommittedByAll(options?: {
        expectedCountPerPeer?: number;
        timeoutMs?: number;
    }) {
        return new HarnessBlock(async (harness) => {
            await harness.assertActions.disputeCommittedByAll(options);
            return harness;
        });
    }

    /**
     * Assert no disputes occurred (neither initiated nor committed)
     */
    static noDisputes() {
        return new HarnessBlock(async (harness) => {
            harness.assertActions.assertNoDisputes();
            return harness;
        });
    }

    /**
     * Assert honest peers initiated disputes
     *
     */
    static honestPeersInitiateDispute(options?: {
        timeoutMs?: number;
        expectedCountPerPeer?: number;
    }) {
        return new HarnessBlock(async (harness) => {
            await harness.assertActions.honestPeersInitiateDispute(options);
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

            harness.assertActions.assertTimeoutIsForced({
                participant,
                peerToCheck,
                forkId
            });

            return harness;
        });
    }
}
