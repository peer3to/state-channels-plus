import { ForkId, Hash } from "@/types";
import {
    DisputeFraudProofType,
    FraudProofType,
    toSolidityDisputeFraudProofType,
    toSolidityFraudProofType
} from "@/types/sol-enums";
import { DetachedPromises } from "@/utils";
import PeerTestHarness from "@test/fixtures/PeerTestHarness";
import { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";

export class AssertStorageActions {
    constructor(private readonly harness: PeerTestHarness) {}

    async honestPeersStoredBlockAndState(
        height: number,
        forkId: ForkId = this.harness.activeForkId!
    ): Promise<void> {
        if (!forkId) throw new Error("No active fork ID");

        const honestPeers = this.harness.getHonestPeers();
        if (honestPeers.length === 0)
            throw new Error("No honest peers available to inspect storage");

        const hashes = await Promise.all(
            honestPeers.map((peer) =>
                this.assertStoredBlockAndStateExists(peer.index, forkId, height)
            )
        );

        const referenceHash = hashes[0];
        for (let i = 1; i < hashes.length; i++) {
            if (hashes[i] !== referenceHash) {
                throw new Error(
                    `Peer ${honestPeers[i].index} stored block ${hashes[i]} for ${forkId}:${height}, expected ${referenceHash} from peer ${honestPeers[0].index}`
                );
            }
        }
    }

    honestPeersStoredBlockAndStateWait(options: {
        height: number;
        forkId?: ForkId;
        timeoutMs?: number;
    }): Promise<void> {
        const forkId = options.forkId ?? this.harness.activeForkId;

        return this.harness.eventCountsBarrier.waitFor(
            async () => {
                try {
                    await this.honestPeersStoredBlockAndState(
                        options.height,
                        forkId
                    );
                    return true;
                } catch {
                    return false;
                }
            },
            {
                timeoutMs: options.timeoutMs,
                timeoutMessageFn: async () => {
                    let msg = `Block and state were not stored on all honest peers within ${options.timeoutMs ?? 5000}ms for ${forkId}:${options.height}`;
                    try {
                        await this.honestPeersStoredBlockAndState(
                            options.height,
                            forkId
                        );
                    } catch (err) {
                        msg += ` - ${err instanceof Error ? err.message : String(err)}`;
                    }
                    return msg;
                }
            }
        );
    }

    honestPeersObserveInboundMessageWait(options?: {
        previousLatestHash?: Hash;
        peerIndices?: number[];
        timeoutMs?: number;
    }): Promise<void> {
        const honestPeers = this.harness.getFilteredOrHonestPeers(
            options?.peerIndices
        );

        const condition = async () => {
            const hashes = await Promise.all(
                honestPeers.map((peer) =>
                    peer.blocks.queryInboundLatestBlockHash()
                )
            );
            const hasNewHash = (h: Hash | undefined) =>
                !!h && h !== options?.previousLatestHash;
            return hashes.every(hasNewHash);
        };

        return this.harness.eventCountsBarrier.waitFor(condition, {
            timeoutMs: options?.timeoutMs,
            timeoutMessage: `Honest peers did not observe inbound message within ${options?.timeoutMs ?? 5000}ms`
        });
    }

    async honestPeersObserveInboundMessageDetached(options?: {
        previousLatestHash?: Hash;
        peerIndices?: number[];
        timeoutMs?: number;
    }): Promise<void> {
        const promise = this.honestPeersObserveInboundMessageWait(options);
        DetachedPromises.collect(promise);
    }

    async honestPeersStoredFraudProof(options: {
        fraudProofType?: FraudProofType;
        peerIndices?: number[];
        maliciousPeerIndex: number;
        atLeastOneHonestPeer?: boolean;
    }): Promise<void> {
        const {
            fraudProofType,
            peerIndices,
            maliciousPeerIndex,
            atLeastOneHonestPeer = true
        } = options;
        const maliciousPeer = this.harness.getPeerHandle(maliciousPeerIndex);
        const honestPeers = this.harness.getFilteredOrHonestPeers(peerIndices);

        if (atLeastOneHonestPeer) {
            const failures: string[] = [];
            for (const honestPeer of honestPeers) {
                try {
                    await this.assertHonestPeerStoredFraudProofForMalicious({
                        honestPeerIndex: honestPeer.index,
                        maliciousPeerAddress: maliciousPeer.address,
                        maliciousPeerIndex,
                        fraudProofType
                    });
                    return;
                } catch (err) {
                    failures.push(
                        err instanceof Error ? err.message : String(err)
                    );
                }
            }
            const peerList = honestPeers.map((p) => p.index).join(", ");
            throw new Error(
                `Expected at least one honest peer among [${peerList}] to store fraud proof for malicious peer ${maliciousPeerIndex}` +
                    (fraudProofType ? ` (type ${fraudProofType})` : "") +
                    `. Per-peer: ${failures.join(" | ")}`
            );
        }

        for (const honestPeer of honestPeers) {
            await this.assertHonestPeerStoredFraudProofForMalicious({
                honestPeerIndex: honestPeer.index,
                maliciousPeerAddress: maliciousPeer.address,
                maliciousPeerIndex,
                fraudProofType
            });
        }
    }

    private async assertHonestPeerStoredFraudProofForMalicious(options: {
        honestPeerIndex: number;
        maliciousPeerAddress: string;
        maliciousPeerIndex: number;
        fraudProofType?: FraudProofType;
    }): Promise<void> {
        const {
            honestPeerIndex,
            maliciousPeerAddress,
            maliciousPeerIndex,
            fraudProofType
        } = options;
        const fraudProof = await this.harness
            .getPeerHandle(honestPeerIndex)
            .dispute.queryFraudProofForParticipant(maliciousPeerAddress);
        if (!fraudProof) {
            throw new Error(
                `Peer ${honestPeerIndex} has no fraud proofs for malicious peer ${maliciousPeerIndex}`
            );
        }
        if (fraudProofType) {
            if (
                fraudProof.proofType !==
                toSolidityFraudProofType(fraudProofType)
            ) {
                throw new Error(
                    `Peer ${honestPeerIndex} has a fraud proof for malicious peer ${maliciousPeerIndex}, but it is of type ${fraudProof.proofType} instead of ${fraudProofType}`
                );
            }
        }
    }

    async honestPeersStoredDisputeFraudProof(options: {
        disputeFraudProofType: DisputeFraudProofType;
        peerIndices?: number[];
    }): Promise<void> {
        const { disputeFraudProofType, peerIndices } = options;
        const peers = this.harness.getFilteredOrHonestPeers(peerIndices);
        if (peers.length === 0) {
            throw new Error(
                peerIndices?.length
                    ? `No peers found for peerIndices ${JSON.stringify(peerIndices)}`
                    : "No honest peers in harness to check dispute fraud proof storage"
            );
        }
        const want = toSolidityDisputeFraudProofType(disputeFraudProofType);

        for (const peer of peers) {
            const proofs = await peer.dispute.queryDisputeFraudProofs();
            if (!proofs.some((p) => p.proofType === want)) {
                throw new Error(
                    `Peer ${peer.index} should store dispute fraud proof type ${disputeFraudProofType}`
                );
            }
        }
    }

    honestPeersStoredDisputeFraudProofWait(options: {
        disputeFraudProofType: DisputeFraudProofType;
        peerIndices?: number[];
        timeoutMs?: number;
    }): Promise<void> {
        const { timeoutMs, disputeFraudProofType, ...rest } = options;
        return this.harness.eventCountsBarrier.waitFor(
            async () => {
                try {
                    await this.honestPeersStoredDisputeFraudProof({
                        disputeFraudProofType,
                        ...rest
                    });
                    return true;
                } catch {
                    return false;
                }
            },
            {
                timeoutMs,
                timeoutMessage: `Not all checked peers stored dispute fraud proof type ${disputeFraudProofType} within ${timeoutMs ?? 5000}ms`,
                label: `disputeFraudProofWait:${disputeFraudProofType}`
            }
        );
    }

    async honestPeersStoredDisputeFraudProofDetached(options: {
        disputeFraudProofType: DisputeFraudProofType;
        peerIndices?: number[];
        timeoutMs?: number;
    }): Promise<void> {
        DetachedPromises.collect(
            this.honestPeersStoredDisputeFraudProofWait(options)
        );
    }

    async storedTimeout(options: {
        timedoutParticipantIndex: number;
        peerToCheck?: number;
        forkId?: ForkId;
        isForced?: boolean;
    }): Promise<void> {
        const {
            timedoutParticipantIndex,
            peerToCheck = 0,
            forkId = this.harness.activeForkId,
            isForced = false
        } = options;

        if (!forkId) {
            throw new Error("No active fork ID");
        }

        const timeout = await this.harness
            .getPeerHandle(peerToCheck)
            .dispute.queryTimeoutForFork(forkId);

        if (!timeout) {
            throw new Error(`No timeout found for fork ${forkId}`);
        }

        if (isForced && !timeout.isForced) {
            throw new Error(`Expected timeout to be forced, but it was not`);
        }

        if (
            timeout.participant !==
            this.harness.getPeerHandle(timedoutParticipantIndex).address
        ) {
            throw new Error(
                `Expected timeout participant to be peer ${timedoutParticipantIndex} (${this.harness.getPeerHandle(timedoutParticipantIndex).address}), ` +
                    `but was ${timeout.participant}`
            );
        }
    }

    async storedDisputeConfirmations(options?: {
        peerIndices?: number[];
        disputeHashes?: Hash[];
        forkId?: ForkId;
    }): Promise<void> {
        const {
            peerIndices,
            disputeHashes = await this.harness.query.getDisputeHashes({
                peerIndices,
                disputedForkId: options?.forkId
            })
        } = options || {};

        if (!disputeHashes || disputeHashes.length === 0) {
            throw new Error(
                "No dispute hash provided and no dispute available to derive hash"
            );
        }
        const peers = this.harness.getFilteredOrHonestPeers(peerIndices);
        for (const peer of peers) {
            for (const disputeHash of disputeHashes) {
                const disputeConfirmation =
                    await peer.dispute.queryDisputeConfirmation(
                        String(disputeHash)
                    );
                if (!disputeConfirmation) {
                    throw new Error(
                        `No dispute confirmation found for hash ${disputeHash} on peer ${peer.index}`
                    );
                }
            }
        }
    }
    async storedDisputeConfirmationsWait(options?: {
        peerIndices?: number[];
        disputeHashes?: Hash[];
        forkId?: ForkId;
        timeoutMs?: number;
    }): Promise<void> {
        const condition = async () => {
            try {
                await this.storedDisputeConfirmations(options);
                return true;
            } catch (error) {
                return false;
            }
        };

        const promise = this.harness.eventCountsBarrier.waitFor(condition, {
            timeoutMs: options?.timeoutMs,
            timeoutMessageFn: async () => {
                let errorMsg = `Dispute confirmations were not stored on all peers within ${options?.timeoutMs ?? 5000}ms`;
                try {
                    await this.storedDisputeConfirmations(options);
                } catch (error) {
                    errorMsg += ` - ${error instanceof Error ? error.message : String(error)}`;
                }
                return errorMsg;
            }
        });
        return promise;
    }

    private async assertStoredBlockAndStateExists(
        peerIndex: number,
        forkId: ForkId,
        height: number
    ): Promise<Hash> {
        const block = await this.harness
            .getPeerHandle(peerIndex)
            .blocks.queryBlockAt({ forkId, height });
        if (!block)
            throw new Error(
                `Peer ${peerIndex} has not stored block for ${forkId}:${height}`
            );
        return block.hash;
    }
}
