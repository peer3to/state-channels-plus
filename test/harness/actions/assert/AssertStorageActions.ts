import { ForkId } from "@/types";
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

    honestPeersStoredFraudProof(options: {
        fraudProofType?: FraudProofType;
        maliciousPeerIndex: number;
    }): void {
        const { fraudProofType, maliciousPeerIndex } = options;
        const maliciousPeer = this.harness.getPeer(maliciousPeerIndex);
        const honestPeers = this.harness.getHonestPeers();

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
        dispute?: DisputeStruct;
    }): void {
        const {
            disputeFraudProofType,
            dispute = this.harness.context.lastTamperedDispute
        } = options || {};
        const honestPeers = this.harness.getHonestPeers();
        if (!dispute)
            throw new Error(
                "No dispute provided and no last tampered dispute in context"
            );
        for (const honestPeer of honestPeers) {
            const peerStorage = this.harness.query.getPeerStorage(
                honestPeer.index
            );
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

    honestPeersStoredDisputeFraudProofWait(options?: {
        disputeFraudProofType?: DisputeFraudProofType;
        dispute?: DisputeStruct;
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
        dispute?: DisputeStruct;
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
}
