import { ForkId, Hash } from "@/types";
import {
    DisputeFraudProofType,
    FraudProofType,
    toSolidityDisputeFraudProofType,
    toSolidityFraudProofType
} from "@/types/sol-enums";
import { DetachedPromises } from "@/utils";
import PeerTestHarness from "@test/fixtures/PeerTestHarness";
import type { HarnessControlRpc } from "@test/fixtures/customRpc/harnessControl/HarnessControlRpc";

export class AssertStorageActions<
    TCustomRpc extends HarnessControlRpc = HarnessControlRpc
> {
    constructor(private readonly harness: PeerTestHarness<TCustomRpc>) {}

    async honestPeersStoredBlockAndState(
        height: number,
        forkId: ForkId = this.harness.activeForkId!
    ): Promise<void> {
        if (!forkId) {
            throw new Error("No active fork ID");
        }

        const honestPeers = this.harness.getHonestPeers();
        if (honestPeers.length === 0) {
            throw new Error("No honest peers available to inspect storage");
        }

        const referencePeer = honestPeers[0];
        const referenceBlockHash = await this.assertStoredBlockAndStateExists(
            referencePeer.index,
            forkId,
            height
        );

        for (const peer of honestPeers.slice(1)) {
            const peerBlockHash = await this.assertStoredBlockAndStateExists(
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
        const timeoutMs =
            options.timeoutMs ??
            this.harness.event.protocolEventTimeoutMs({
                withFirstBlockGrace: true
            });

        const condition = async () => {
            try {
                await this.honestPeersStoredBlockAndState(
                    options.height,
                    forkId
                );
                return true;
            } catch {
                return false;
            }
        };

        return this.harness.eventCountsBarrier.waitFor(condition, {
            timeoutMs,
            timeoutMessageFn: async () => {
                let errorMsg = `Block and state were not stored on all honest peers within ${timeoutMs}ms for ${forkId}:${options.height}`;
                try {
                    await this.honestPeersStoredBlockAndState(
                        options.height,
                        forkId
                    );
                } catch (error) {
                    errorMsg += ` - ${error instanceof Error ? error.message : String(error)}`;
                }
                return errorMsg;
            }
        });
    }

    honestPeersObserveInboundMessageWait(options?: {
        previousLatestHash?: Hash;
        peerIndices?: number[];
        timeoutMs?: number;
    }): Promise<void> {
        const timeoutMs =
            options?.timeoutMs ??
            this.harness.event.protocolEventTimeoutMs({
                withFirstBlockGrace: true
            });
        const honestPeers = this.harness.getFilteredOrHonestPeers(
            options?.peerIndices
        );

        const condition = async () => {
            for (const peer of honestPeers) {
                const latestHash = await this.harness
                    .control(peer)
                    .query.getLatestInboundMessageHash()
                    .request();
                if (!latestHash || latestHash === options?.previousLatestHash) {
                    return false;
                }
            }
            return true;
        };

        return this.harness.eventCountsBarrier.waitFor(condition, {
            timeoutMs,
            timeoutMessage: `Honest peers did not observe inbound message within ${timeoutMs}ms`
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
        const maliciousPeer = this.harness.getPeer(maliciousPeerIndex);
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
        const honestPeer = this.harness.getPeer(honestPeerIndex);
        const proofType = await this.harness
            .control(honestPeer)
            .query.getFraudProofType(maliciousPeerAddress)
            .request();
        if (proofType === null) {
            throw new Error(
                `Peer ${honestPeerIndex} has no fraud proofs for malicious peer ${maliciousPeerIndex}`
            );
        }
        if (
            fraudProofType &&
            proofType !== String(toSolidityFraudProofType(fraudProofType))
        ) {
            throw new Error(
                `Peer ${honestPeerIndex} has a fraud proof for malicious peer ${maliciousPeerIndex}, but it is of type ${proofType} instead of ${fraudProofType}`
            );
        }
    }

    async honestPeersStoredDisputeFraudProof(options: {
        disputeFraudProofType: DisputeFraudProofType;
        peerIndices?: number[];
        atLeastOneHonestPeer?: boolean;
    }): Promise<void> {
        const {
            disputeFraudProofType,
            peerIndices,
            atLeastOneHonestPeer = false
        } = options;
        const peers = this.harness.getFilteredOrHonestPeers(peerIndices);
        if (peers.length === 0) {
            throw new Error(
                peerIndices?.length
                    ? `No peers found for peerIndices ${JSON.stringify(peerIndices)}`
                    : "No honest peers in harness to check dispute fraud proof storage"
            );
        }
        const want = String(
            toSolidityDisputeFraudProofType(disputeFraudProofType)
        );

        if (atLeastOneHonestPeer) {
            const failures: string[] = [];
            for (const peer of peers) {
                const proofTypes = await this.harness
                    .control(peer)
                    .query.getDisputeFraudProofTypes()
                    .request();
                if (proofTypes.includes(want)) {
                    return;
                }
                failures.push(
                    `peer ${peer.index} stored [${proofTypes.join(", ")}]`
                );
            }
            throw new Error(
                `Expected at least one honest peer to store dispute fraud proof type ${disputeFraudProofType}. ${failures.join(" | ")}`
            );
        }

        for (const peer of peers) {
            const proofTypes = await this.harness
                .control(peer)
                .query.getDisputeFraudProofTypes()
                .request();
            if (!proofTypes.includes(want)) {
                throw new Error(
                    `Peer ${peer.index} should store dispute fraud proof type ${disputeFraudProofType}`
                );
            }
        }
    }

    honestPeersStoredDisputeFraudProofWait(options: {
        disputeFraudProofType: DisputeFraudProofType;
        peerIndices?: number[];
        atLeastOneHonestPeer?: boolean;
        timeoutMs?: number;
    }): Promise<void> {
        const { timeoutMs, disputeFraudProofType, ...rest } = options;
        const waitTimeoutMs =
            timeoutMs ??
            this.harness.event.protocolEventTimeoutMs({
                withFirstBlockGrace: true
            });
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
                timeoutMs: waitTimeoutMs,
                timeoutMessage: `Not all checked peers stored dispute fraud proof type ${disputeFraudProofType} within ${waitTimeoutMs}ms`,
                label: `disputeFraudProofWait:${disputeFraudProofType}`
            }
        );
    }

    async honestPeersStoredDisputeFraudProofDetached(options: {
        disputeFraudProofType: DisputeFraudProofType;
        peerIndices?: number[];
        atLeastOneHonestPeer?: boolean;
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
            .control(this.harness.getPeer(peerToCheck))
            .query.getTimeout(forkId)
            .request();

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
            for (const disputeHash of disputeHashes) {
                const present = await this.harness
                    .control(peer)
                    .query.hasDisputeConfirmation(disputeHash)
                    .request();
                if (!present) {
                    const existing = await this.harness
                        .control(peer)
                        .query.getDisputeConfirmationHashes()
                        .request();
                    throw new Error(
                        `No dispute confirmation found for hash ${disputeHash} on peer ${peer.index}, existing confirmations: ${JSON.stringify(existing)}`
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
        const timeoutMs =
            options?.timeoutMs ??
            this.harness.event.protocolEventTimeoutMs({
                withFirstBlockGrace: true
            });
        const condition = async () => {
            try {
                await this.storedDisputeConfirmations(options);
                return true;
            } catch {
                return false;
            }
        };

        return this.harness.eventCountsBarrier.waitFor(condition, {
            timeoutMs,
            timeoutMessageFn: async () => {
                let errorMsg = `Dispute confirmations were not stored on all peers within ${timeoutMs}ms`;
                try {
                    await this.storedDisputeConfirmations(options);
                } catch (error) {
                    errorMsg += ` - ${error instanceof Error ? error.message : String(error)}`;
                }
                return errorMsg;
            }
        });
    }

    private async assertStoredBlockAndStateExists(
        peerIndex: number,
        forkId: ForkId,
        height: number
    ): Promise<Hash> {
        const result = await this.harness
            .control(this.harness.getPeer(peerIndex))
            .query.assertStoredBlockChain(forkId, height)
            .request();
        if (!result.ok) {
            throw new Error(
                `Peer ${peerIndex} block-chain incomplete for ${forkId}:${height}: ${result.reason}`
            );
        }
        return result.blockHash as Hash;
    }
}
