import {
    PeerTestHarness,
    TestPeer,
    CreateAndResolveDisputeResult,
    CreateAndResolveForkResult
} from "@test/fixtures/PeerTestHarness";
import { Logger, SignatureUtils } from "@/utils";
import { ForkId } from "@/types/types";
import { ZeroHash, BytesLike } from "ethers";
import { expect } from "chai";
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
     * Creates a dispute via the provided action, then waits until:
     * - disputes are committed on-chain (observed via onDisputeCommitted events)
     * - honest peers converge on a new fork (fork reduction settled)
     */
    async createAndResolveDispute(
        disputeAction: () => Promise<void>,
        maliciousPeerIndex: number,
        options?: {
            forkId?: ForkId;
            honestPeerIndices?: number[];
            resetEventSpies?: boolean;
            disputesCommittedTimeoutMs?: number;
            forkSettleTimeoutMs?: number;
            expectedDisputesCommittedPerPeer?: number;
            disputesCommittedMode?: "exact" | "atLeast";
            assertMaliciousRemoved?: boolean;
        }
    ): Promise<CreateAndResolveDisputeResult<any, any>> {
        const originalForkId = options?.forkId || this.harness.activeForkId!;
        const honestPeerIndices =
            options?.honestPeerIndices ??
            (await this.getParticipantPeerIndices()).filter(
                (i) => i !== maliciousPeerIndex
            );

        if (honestPeerIndices.length < 1) {
            throw new Error(
                `Need at least 1 honest peer to resolve dispute (got ${honestPeerIndices.length})`
            );
        }

        if (options?.resetEventSpies !== false) {
            this.harness.eventActions.resetEventSpies();
        }

        await disputeAction();

        const disputesCommittedTimeoutMs =
            options?.disputesCommittedTimeoutMs ?? 5000;

        const expectedDisputesCommittedPerPeer =
            options?.expectedDisputesCommittedPerPeer ?? 1;

        const disputesCommitted =
            await this.harness.eventActions.waitForEventCounts(
                "onDisputeCommitted",
                honestPeerIndices.map((peerId) => ({
                    peerId,
                    expectedCount: expectedDisputesCommittedPerPeer
                })),
                disputesCommittedTimeoutMs,
                { mode: options?.disputesCommittedMode ?? "atLeast" }
            );

        if (!disputesCommitted) {
            throw new Error(
                `Disputes not committed across peers within ${String(
                    disputesCommittedTimeoutMs
                )}ms`
            );
        }

        // Wait for fork to change using event barrier
        const forkSettled = await this.harness.waitForForkChange({
            excludeForkIds: [originalForkId],
            peerIndices: honestPeerIndices,
            timeoutMs: options?.forkSettleTimeoutMs ?? 10000
        });

        if (!forkSettled) {
            throw new Error(
                `Fork did not settle within ${String(
                    options?.forkSettleTimeoutMs ?? 10000
                )}ms`
            );
        }

        const honestPeers = honestPeerIndices.map((idx) =>
            this.harness.getPeer(idx)
        );
        const newForkId = honestPeers[0]!.stateManager.forkId;

        if (newForkId === originalForkId || newForkId === ZeroHash) {
            throw new Error(
                `Expected new forkId after reduction (got ${newForkId})`
            );
        }

        if (options?.assertMaliciousRemoved ?? true) {
            const maliciousAddress =
                this.harness.getPeer(maliciousPeerIndex).address;
            for (const peer of honestPeers) {
                const participants =
                    await peer.stateManager.diamondStateMachine.getParticipants();
                expect(participants).to.have.lengthOf(honestPeers.length);
                expect(participants).to.not.include(maliciousAddress);
            }
        }

        return {
            originalForkId,
            newForkId,
            maliciousPeerIndex,
            honestPeerIndices,
            honestPeers
        };
    }

    async createAndResolveInvalidStateTransitionDispute(
        maliciousPeerIndex: number,
        options?: {
            forkId?: ForkId;
            honestPeerIndices?: number[];
            resetEventSpies?: boolean;
            disputesCommittedTimeoutMs?: number;
            forkSettleTimeoutMs?: number;
            disputesCommittedMode?: "exact" | "atLeast";
            expectedDisputesCommittedPerPeer?: number;
            assertMaliciousRemoved?: boolean;
        }
    ): Promise<CreateAndResolveDisputeResult<any, any>> {
        return this.createAndResolveDispute(
            async () => {
                await this.harness.byzantineActions.submitInvalidStateTransitionBlock(
                    maliciousPeerIndex,
                    {
                        forkId: options?.forkId || this.harness.activeForkId!
                    }
                );
            },
            maliciousPeerIndex,
            options
        );
    }

    /**
     * Helper for tests that induce a fork via a double-sign block, then wait until
     * honest peers converge on the reduced fork.
     */
    async createAndResolveDoubleSignFork(
        maliciousPeerIndex: number,
        options?: {
            forkId?: ForkId;
            honestPeerIndices?: number[];
            providerPeerIndex?: number;
            resetEventSpies?: boolean;
            waitForForkDisputedTimeoutMs?: number;
            forkSettleTimeoutMs?: number;
            disposeMaliciousPeer?: boolean;
        }
    ): Promise<CreateAndResolveForkResult<any, any>> {
        const originalForkId = options?.forkId || this.harness.activeForkId!;
        const honestPeerIndices =
            options?.honestPeerIndices ??
            (
                await this.getParticipantPeerIndices(
                    options?.providerPeerIndex ?? 0
                )
            ).filter((i) => i !== maliciousPeerIndex);

        if (honestPeerIndices.length < 2) {
            throw new Error(
                `Need at least 2 honest peers to resolve fork (got ${honestPeerIndices.length})`
            );
        }

        if (options?.resetEventSpies !== false) {
            this.harness.eventActions.resetEventSpies();
        }

        await this.harness.byzantineActions.submitDoubleSignBlock(
            maliciousPeerIndex,
            {
                forkId: originalForkId
            }
        );

        const providerPeerIndex =
            options?.providerPeerIndex ?? honestPeerIndices[0]!;
        const provider = this.harness.getPeer(providerPeerIndex);

        const forkDisputed = await this.harness.waitForCondition(
            async () => {
                return await provider.stateManager.diamondStateMachine.localDiamondContract.isForkDisputed(
                    this.harness.channelId,
                    originalForkId
                );
            },
            options?.waitForForkDisputedTimeoutMs ?? 15000,
            250
        );

        if (!forkDisputed) {
            throw new Error(
                `Fork was not disputed within ${String(
                    options?.waitForForkDisputedTimeoutMs ?? 15000
                )}ms`
            );
        }

        if (options?.disposeMaliciousPeer ?? true) {
            await this.harness
                .getPeer(maliciousPeerIndex)
                .p2pInstance.dispose();
        }

        // Wait for fork to settle using event barrier
        const forkSettled = await this.harness.waitForForkChange({
            excludeForkIds: [originalForkId],
            peerIndices: honestPeerIndices,
            timeoutMs: options?.forkSettleTimeoutMs ?? 20000
        });

        if (!forkSettled) {
            throw new Error(
                `Fork did not settle within ${String(
                    options?.forkSettleTimeoutMs ?? 20000
                )}ms`
            );
        }

        const honestPeers = honestPeerIndices.map((idx) =>
            this.harness.getPeer(idx)
        );
        const reducedForkId = honestPeers[0]!.stateManager.forkId;

        if (reducedForkId === originalForkId || reducedForkId === ZeroHash) {
            throw new Error(
                `Expected reduced forkId after settlement (got ${reducedForkId})`
            );
        }

        return {
            originalForkId,
            reducedForkId,
            maliciousPeerIndex,
            honestPeerIndices,
            honestPeers
        };
    }

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
