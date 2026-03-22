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
import { ethers } from "ethers";

export class AssertStorageActions {
    constructor(private readonly harness: PeerTestHarness) {}

    honestPeersStoredBlockAndState(
        height: number,
        forkId: ForkId = this.harness.activeForkId!
    ): void {
        if (!forkId) {
            throw new Error("No active fork ID");
        }

        const honestPeers = this.harness.getHonestPeers();
        if (honestPeers.length === 0) {
            throw new Error("No honest peers available to inspect storage");
        }

        const referencePeer = honestPeers[0];
        const referenceBlockHash = this.assertStoredBlockAndStateExists(
            referencePeer.index,
            forkId,
            height
        );

        for (const peer of honestPeers.slice(1)) {
            const peerBlockHash = this.assertStoredBlockAndStateExists(
                peer.index,
                forkId,
                height
            );

            if (peerBlockHash !== referenceBlockHash) {
                throw new Error(
                    `Peer ${peer.index} stored block ${peerBlockHash} for ${forkId}:${height}, expected ${referenceBlockHash} from peer ${referencePeer.index}`
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

        const condition = () => {
            try {
                this.honestPeersStoredBlockAndState(options.height, forkId);
                return true;
            } catch (error) {
                return false;
            }
        };

        const promise = this.harness.eventCountsBarrier.waitFor(condition, {
            timeoutMs: options.timeoutMs,
            timeoutMessageFn: async () => {
                let errorMsg = `Block and state were not stored on all honest peers within ${options.timeoutMs ?? 5000}ms for ${forkId}:${options.height}`;
                try {
                    this.honestPeersStoredBlockAndState(options.height, forkId);
                } catch (error) {
                    errorMsg += ` - ${error instanceof Error ? error.message : String(error)}`;
                }
                return errorMsg;
            }
        });
        return promise;
    }

    honestPeersStoredFraudProof(options: {
        fraudProofType?: FraudProofType;
        peerIndices?: number[];
        maliciousPeerIndex: number;
        atLeastOneHonestPeer?: boolean;
    }): void {
        const {
            fraudProofType,
            peerIndices,
            maliciousPeerIndex,
            atLeastOneHonestPeer = true
        } = options;
        const maliciousPeer = this.harness.getPeer(maliciousPeerIndex);
        const honestPeers = this.harness.getFilteredOrHonestPeers(peerIndices);

        if (atLeastOneHonestPeer) {
            const failures: string[] = [];
            for (const honestPeer of honestPeers) {
                try {
                    this.assertHonestPeerStoredFraudProofForMalicious({
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
            this.assertHonestPeerStoredFraudProofForMalicious({
                honestPeerIndex: honestPeer.index,
                maliciousPeerAddress: maliciousPeer.address,
                maliciousPeerIndex,
                fraudProofType
            });
        }
    }

    private assertHonestPeerStoredFraudProofForMalicious(options: {
        honestPeerIndex: number;
        maliciousPeerAddress: string;
        maliciousPeerIndex: number;
        fraudProofType?: FraudProofType;
    }): void {
        const {
            honestPeerIndex,
            maliciousPeerAddress,
            maliciousPeerIndex,
            fraudProofType
        } = options;
        const peerStorage = this.harness.query.getPeerStorage(honestPeerIndex);
        const fraudProof =
            peerStorage.fraudProofs.getFraudProofForParticipant(
                maliciousPeerAddress
            );
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
        timedoutParticipantIndex: number;
        peerToCheck?: number;
        forkId?: ForkId;
        isForced?: boolean;
    }): void {
        const {
            timedoutParticipantIndex,
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

        if (
            timeout.participant !==
            this.harness.peers[timedoutParticipantIndex].address
        ) {
            throw new Error(
                `Expected timeout participant to be peer ${timedoutParticipantIndex} (${this.harness.peers[timedoutParticipantIndex].address}), ` +
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

    private assertStoredBlockAndStateExists(
        peerIndex: number,
        forkId: ForkId,
        height: number
    ): Hash {
        const storage = this.harness.query.getPeerStorage(peerIndex);
        const block = storage.blocks.getBlock(forkId, height);

        if (!block) {
            throw new Error(
                `Peer ${peerIndex} has no persisted block for ${forkId}:${height}`
            );
        }

        const snapshot = storage.stateSnapshots.getStateSnapshotByHash(
            block.stateSnapshotHash
        );
        if (!snapshot) {
            throw new Error(
                `Peer ${peerIndex} is missing state snapshot ${block.stateSnapshotHash} for ${forkId}:${height}`
            );
        }

        const stateMachineState =
            storage.stateMachineStates.getStateMachineState(
                snapshot.stateMachineStateHash
            );
        if (!stateMachineState) {
            throw new Error(
                `Peer ${peerIndex} is missing state machine state ${snapshot.stateMachineStateHash} for ${forkId}:${height}`
            );
        }

        for (const messageBlock of block.messageBlocks) {
            const messageBlockHash = hash(
                Codec.encode(messageBlock, Type.MessageBlock)
            ) as Hash;

            if (!storage.inboundMessages.getMessageBlock(messageBlockHash)) {
                throw new Error(
                    `Peer ${peerIndex} is missing inbound message block ${messageBlockHash} referenced by ${forkId}:${height}`
                );
            }
        }

        if (
            snapshot.latestInboundMessageBlockHash !== ethers.ZeroHash &&
            !storage.inboundMessages.getMessageBlock(
                snapshot.latestInboundMessageBlockHash
            )
        ) {
            throw new Error(
                `Peer ${peerIndex} is missing inbound message block ${snapshot.latestInboundMessageBlockHash} referenced by ${forkId}:${height}`
            );
        }

        if (
            snapshot.latestOutboundMessageBlockHash !== ethers.ZeroHash &&
            !storage.outboundMessages.getMessageBlock(
                snapshot.latestOutboundMessageBlockHash
            )
        ) {
            throw new Error(
                `Peer ${peerIndex} is missing outbound message block ${snapshot.latestOutboundMessageBlockHash} referenced by ${forkId}:${height}`
            );
        }

        return block.hash;
    }
}
