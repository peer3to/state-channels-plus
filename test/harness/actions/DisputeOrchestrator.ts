import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import type { HarnessControlRpc } from "@test/fixtures/customRpc/harnessControl/HarnessControlRpc";
import { CreateAndResolveDisputeResult } from "../core/types";
import { Logger } from "@/utils";
import { ForkId } from "@/types/types";
import { ZeroHash } from "ethers";
import { Status } from "@/types";
import { FraudProofType } from "@/types/sol-enums";
import type {
    DisputeConfirmationStruct,
    DisputeStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import type { FinalDisputeResolution } from "./DisputeTamperingActions";

export type SubmittedFinalDispute = {
    forkId: ForkId;
    finalAuthorPeerIndex: number;
    suppressedPeerIndices: number[];
    finalResolution: FinalDisputeResolution;
    dispute: DisputeStruct;
    disputeConfirmation: DisputeConfirmationStruct;
};

export type DisputeResolutionExpectation = {
    kind: "final-dispute" | "reduction";
    forkId: ForkId;
    genesisTimestamp: number;
    assertParticipantsRemain?: boolean;
};

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

    async submitFinalDispute(options: {
        maliciousPeerIndex: number;
        forkId?: ForkId;
        finalAuthorPeerIndex?: number;
    }): Promise<SubmittedFinalDispute> {
        const forkId = options.forkId ?? this.harness.activeForkId!;
        const finalAuthor =
            options.finalAuthorPeerIndex !== undefined
                ? this.harness.getPeer(options.finalAuthorPeerIndex)
                : [...this.harness.peers]
                      .reverse()
                      .find(
                          (peer) => peer.index !== options.maliciousPeerIndex
                      );
        if (!finalAuthor) {
            throw new Error(
                "No participant available to author the final dispute"
            );
        }
        const honestPeers = this.harness.peers.filter(
            (peer) => peer.index !== options.maliciousPeerIndex
        );
        for (const peer of honestPeers) {
            await this.harness
                .control(peer)
                .stub.stubSuppressDisputeInitiation()
                .request();
        }
        try {
            await this.harness.byzantine.submitDoubleSignBlock(
                options.maliciousPeerIndex,
                { forkId }
            );
            await this.harness.eventCountsBarrier.waitFor(
                async () => {
                    try {
                        await this.harness.assert.storage.honestPeersStoredFraudProof(
                            {
                                fraudProofType: FraudProofType.BlockDoubleSign,
                                maliciousPeerIndex: options.maliciousPeerIndex,
                                peerIndices: [finalAuthor.index],
                                atLeastOneHonestPeer: false
                            }
                        );
                        return true;
                    } catch {
                        return false;
                    }
                },
                {
                    timeoutMs: 10000,
                    timeoutMessage: `Final-dispute author ${finalAuthor.index} did not store double-sign evidence`,
                    label: "finalDisputeAuthorEvidence"
                }
            );

            return this.postFinalDispute(
                forkId,
                finalAuthor.index,
                honestPeers.map((peer) => peer.index)
            );
        } catch (error) {
            await this.restoreDisputeInitiation(
                honestPeers.map((peer) => peer.index)
            );
            throw error;
        }
    }

    async openOrdinaryDisputeWindow(options: {
        maliciousPeerIndex: number;
        excludedPeerIndex: number;
        forkId?: ForkId;
    }): Promise<ForkId> {
        const forkId = options.forkId ?? this.harness.activeForkId!;
        const excludedPeer = this.harness.getPeer(options.excludedPeerIndex);
        await this.harness
            .control(excludedPeer)
            .stub.stubSuppressDisputeInitiation()
            .request();
        try {
            await this.harness.byzantine.submitDoubleSignBlock(
                options.maliciousPeerIndex,
                { forkId }
            );
            const ordinaryAuthors = this.harness.peers
                .map((peer) => peer.index)
                .filter(
                    (peerIndex) =>
                        peerIndex !== options.maliciousPeerIndex &&
                        peerIndex !== options.excludedPeerIndex
                );
            await this.harness.assert.dispute.initiatedAndCommitedWait({
                peersIndices: ordinaryAuthors,
                expectedCount: ordinaryAuthors.length,
                initiatedWithAuditingData: false
            });
        } finally {
            await this.harness
                .control(excludedPeer)
                .stub.restoreDisputeInitiation()
                .request();
        }
        return forkId;
    }

    async submitFinalDisputeFromStoredEvidence(options: {
        forkId: ForkId;
        finalAuthorPeerIndex: number;
    }): Promise<SubmittedFinalDispute> {
        const finalAuthor = this.harness.getPeer(options.finalAuthorPeerIndex);
        await this.harness
            .control(finalAuthor)
            .stub.stubSuppressDisputeInitiation()
            .request();
        try {
            return await this.postFinalDispute(
                options.forkId,
                options.finalAuthorPeerIndex,
                [options.finalAuthorPeerIndex]
            );
        } catch (error) {
            await this.restoreDisputeInitiation([options.finalAuthorPeerIndex]);
            throw error;
        }
    }

    async resolveFinalDispute(
        submitted: SubmittedFinalDispute,
        options?: {
            honestPeerIndices?: number[];
            syntheticOnChainParticipants?: number;
            expectedDisputesCommittedPerPeer?: number;
        }
    ): Promise<CreateAndResolveDisputeResult<TCustomRpc>> {
        try {
            return await this.resolveDisputeWait({
                forkId: submitted.forkId,
                honestPeerIndices: options?.honestPeerIndices,
                expectedDisputesCommittedPerPeer:
                    options?.expectedDisputesCommittedPerPeer ?? 1,
                disputesCommittedMode: "atLeast",
                disputesCommittedTimeoutMs: 15000,
                forkSettleTimeoutMs: 30000,
                syntheticOnChainParticipants:
                    options?.syntheticOnChainParticipants,
                expectedResolution: {
                    kind: "final-dispute",
                    forkId: submitted.finalResolution.forkId,
                    genesisTimestamp:
                        submitted.finalResolution.genesisTimestamp,
                    assertParticipantsRemain: true
                }
            });
        } finally {
            await this.restoreDisputeInitiation(
                submitted.suppressedPeerIndices
            );
        }
    }

    /**
     * Waits for dispute commitment and resolution, agnostic to how the dispute was created.
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
            expectedResolution?: DisputeResolutionExpectation;
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

        if (options.expectedResolution) {
            await this.harness.eventCountsBarrier.waitFor(
                async () => {
                    const peers = syncPeerIndices.map((index) =>
                        this.harness.getPeer(index)
                    );
                    const forkIds = await this.harness.peerForkIds(peers);
                    return forkIds.every(
                        (forkId) =>
                            forkId === options.expectedResolution!.forkId
                    );
                },
                {
                    timeoutMs: forkSettleTimeoutMs,
                    timeoutMessage: `Honest peers did not resolve fork ${originalForkId} to expected fork ${options.expectedResolution.forkId}`
                }
            );
        } else {
            await this.harness.assert.sync.forkChangedWait({
                originalForkId,
                excludeForkIds: [originalForkId],
                honestPeerIndices: syncPeerIndices,
                timeoutMs: forkSettleTimeoutMs
            });
        }

        const honestPeers = honestPeerIndices.map((idx) =>
            this.harness.getPeer(idx)
        );
        const newForkId = options.expectedResolution
            ? options.expectedResolution.forkId
            : (await this.harness.peerForkIds([honestPeers[0]!]))[0];

        if (newForkId === originalForkId || newForkId === ZeroHash) {
            throw new Error(
                `Expected new forkId after dispute resolution (got ${newForkId})`
            );
        }

        if (options.expectedResolution) {
            for (const peer of honestPeers) {
                const [genesisTimestamp, status] = await Promise.all([
                    this.harness
                        .control(peer)
                        .query.getGenesisSnapshotTimestamp(newForkId)
                        .request(),
                    this.harness.control(peer).query.getStatus().request()
                ]);
                if (
                    genesisTimestamp !==
                    options.expectedResolution.genesisTimestamp
                ) {
                    throw new Error(
                        `Peer ${peer.index} resolved fork ${newForkId} at timestamp ${genesisTimestamp}; expected ${options.expectedResolution.genesisTimestamp}`
                    );
                }
                if (
                    options.expectedResolution.kind === "final-dispute" &&
                    options.expectedResolution.assertParticipantsRemain &&
                    status !== Status.PARTICIPATING
                ) {
                    throw new Error(
                        `Peer ${peer.index} left PARTICIPATING after final dispute resolution (status=${Status[status]})`
                    );
                }
            }
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

    private async postFinalDispute(
        forkId: ForkId,
        finalAuthorPeerIndex: number,
        suppressedPeerIndices: number[]
    ): Promise<SubmittedFinalDispute> {
        const posted = await this.harness.tamper.postTamperedDispute(
            finalAuthorPeerIndex,
            () => {},
            {
                forkId,
                markMalicious: false,
                final: true
            }
        );
        return {
            forkId,
            finalAuthorPeerIndex,
            suppressedPeerIndices,
            finalResolution: posted.finalResolution,
            dispute: posted.dispute,
            disputeConfirmation: posted.disputeConfirmation
        };
    }

    private async restoreDisputeInitiation(
        peerIndices: number[]
    ): Promise<void> {
        for (const peerIndex of peerIndices) {
            await this.harness
                .control(this.harness.getPeer(peerIndex))
                .stub.restoreDisputeInitiation()
                .request();
        }
    }
}
