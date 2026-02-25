import { ForkId, Hash } from "@/types";
import {
    DisputeFraudProofType,
    FraudProofType,
    toSolidityDisputeFraudProofType,
    toSolidityFraudProofType
} from "@/types/sol-enums";
import { Codec, DetachedPromises, hash, Type } from "@/utils";
import PeerTestHarness from "@test/fixtures/PeerTestHarness";
import { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";

export class AssertStorageActions {
    constructor(private readonly harness: PeerTestHarness) {}

    honestPeersStoredFraudProof(options: {
        fraudProofType?: FraudProofType;
        peerIndices?: number[];
        maliciousPeerIndex: number;
    }): void {
        const { fraudProofType, peerIndices, maliciousPeerIndex } = options;
        const maliciousPeer = this.harness.getPeer(maliciousPeerIndex);
        const honestPeers = this.harness.getFilteredOrHonestPeers(peerIndices);

        for (const honestPeer of honestPeers) {
            const peerStorage = this.harness.query.getPeerStorage(
                honestPeer.index
            );
            const fraudProof =
                peerStorage.fraudProofs.getFraudProofForParticipant(
                    maliciousPeer.address
                );
            if (!fraudProof)
                throw new Error(
                    `Peer ${honestPeer.index} has no fraud proofs for malicious peer ${maliciousPeerIndex}`
                );
            if (fraudProofType) {
                if (
                    fraudProof.proofType !==
                    toSolidityFraudProofType(fraudProofType)
                ) {
                    throw new Error(
                        `Peer ${honestPeer.index} has a fraud proof for malicious peer ${maliciousPeerIndex}, but it is of type ${fraudProof.proofType} instead of ${fraudProofType}`
                    );
                }
            }
        }
    }

    honestPeersStoredDisputeFraudProof(options?: {
        disputeFraudProofType?: DisputeFraudProofType;
        disputes?: DisputeStruct[];
    }): void {
        const {
            disputeFraudProofType,
            disputes = this.harness.context.tamperedDisputes
        } = options || {};
        const honestPeers = this.harness.getHonestPeers();
        if (!disputes || disputes.length === 0)
            throw new Error(
                "No disputes provided and no tampered disputes in context"
            );
        for (const honestPeer of honestPeers) {
            const peerStorage = this.harness.query.getPeerStorage(
                honestPeer.index
            );
            for (const dispute of disputes) {
                const dpf =
                    peerStorage.disputeFraudProofs.getDisputeFraudProofForDispute(
                        dispute
                    );
                if (!dpf)
                    throw new Error(
                        `Peer ${honestPeer.index} has no dispute fraud proofs for dispute ${dispute}`
                    );
                if (disputeFraudProofType) {
                    if (
                        dpf.proofType !==
                        toSolidityDisputeFraudProofType(disputeFraudProofType)
                    ) {
                        throw new Error(
                            `Peer ${honestPeer.index} has a dispute fraud proof for dispute ${dispute}, but it is of type ${dpf.proofType} instead of ${disputeFraudProofType}`
                        );
                    }
                }
            }
        }
    }

    honestPeersStoredDisputeFraudProofWait(options?: {
        disputeFraudProofType?: DisputeFraudProofType;
        disputes?: DisputeStruct[];
        timeoutMs?: number;
    }): Promise<void> {
        const condition = () => {
            try {
                this.honestPeersStoredDisputeFraudProof(options);
                return true;
            } catch (error) {
                return false;
            }
        };

        const promise = this.harness.eventCountsBarrier.waitFor(condition, {
            timeoutMs: options?.timeoutMs,
            timeoutMessage: `Dispute fraud proof was not stored on all peers within ${options?.timeoutMs ?? 5000}ms`
        });
        return promise;
    }

    async honestPeersStoredDisputeFraudProofDetached(options?: {
        disputeFraudProofType?: DisputeFraudProofType;
        disputes?: DisputeStruct[];
        timeoutMs?: number;
    }): Promise<void> {
        const promise = this.honestPeersStoredDisputeFraudProofWait(options);
        DetachedPromises.collect(promise);
    }

    storedTimeout(options: {
        participant: number;
        peerToCheck?: number;
        forkId?: ForkId;
        isForced?: boolean;
    }): void {
        const {
            participant,
            peerToCheck = 0,
            forkId = this.harness.activeForkId,
            isForced = false
        } = options;

        if (!forkId) {
            throw new Error("No active fork ID");
        }

        const timeout = this.harness.query
            .getPeerStorage(peerToCheck)
            .timeout.getTimeout(forkId);

        if (!timeout) {
            throw new Error(`No timeout found for fork ${forkId}`);
        }

        if (isForced && !timeout.isForced) {
            throw new Error(`Expected timeout to be forced, but it was not`);
        }

        if (timeout.participant !== this.harness.peers[participant].address) {
            throw new Error(
                `Expected timeout participant to be peer ${participant} (${this.harness.peers[participant].address}), ` +
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
            const storage = this.harness.query.getPeerStorage(peer.index);
            for (const disputeHash of disputeHashes) {
                const disputeConfirmation =
                    storage.disputes.getDisputeConfirmation(disputeHash);
                if (!disputeConfirmation) {
                    const existingConfirmationHashes = Array.from(
                        (storage.disputes as any).disputes.keys()
                    );
                    throw new Error(
                        `No dispute confirmation found for hash ${disputeHash} on peer ${peer.index}, existing confirmations: ${JSON.stringify(existingConfirmationHashes)}`
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
}
