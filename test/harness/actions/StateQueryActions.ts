import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import type { TestPeer } from "@test/harness/core/types";
import { InlinePeer } from "@test/harness/core/InlinePeer";
import { Logger } from "@/utils";
import { Address, BlockHeight, ForkId, Hash } from "@/types/types";
import { ATransport } from "@/transport";
import PeerProfile from "@/PeerProfile";
import { ethers } from "@/index";
import Block from "@/models/Block";
import { StateSnapshot } from "@/models";
import type { StateSnapshotStruct } from "@typechain-types/contracts/V1/types/DataTypes";

/**
 * StateQueryActions handles all read-only state queries.
 * NO MUTATIONS - read-only operations only.
 *
 * Some methods return live inline-only objects (Storage, ATransport, PeerProfile).
 */
export class StateQueryActions {
    constructor(
        private harness: PeerTestHarness,
        private logger: Logger
    ) {}

    public getPeerStorage(peerIndex: number) {
        const handle = this.harness.getPeerHandle(peerIndex) as InlinePeer;
        return handle.peer.stateManager.storage;
    }

    /**
     * Get the latest state machine state hash for a peer - ONLY if it exists in storage
     */
    public async getLatestStateMachineStateHash(
        peerIndex: number
    ): Promise<Hash | null> {
        const forkId = this.harness.activeForkId;
        if (!forkId) return null;
        const handle = this.harness.getPeerHandle(peerIndex);
        const hash = await handle.queryLatestStateMachineStateHash(forkId);
        return hash as Hash | null;
    }

    public getPreviousBlockHash(
        peer: TestPeer,
        forkId: ForkId,
        height?: BlockHeight
    ): Hash {
        if (height !== undefined) {
            const previousBlockOrSnapshot =
                peer.stateManager.storage.getPreviousBlockOrSnapshot({
                    forkId,
                    height
                });
            return previousBlockOrSnapshot.block
                ? previousBlockOrSnapshot.block.hash
                : previousBlockOrSnapshot.stateSnapshot!.hash;
        }

        const previousBlock =
            peer.stateManager.storage.blocks.getLatestBlock(forkId);
        return (
            previousBlock?.hash ||
            peer.stateManager.storage.stateSnapshots.getGenesisSnapshotByForkId(
                forkId
            )?.hash ||
            ethers.ZeroHash
        );
    }

    public getStateSnapshotHash(
        peer: TestPeer,
        forkId: ForkId,
        previousBlock?: Block
    ): Hash {
        return previousBlock
            ? previousBlock.stateSnapshotHash
            : peer.stateManager.storage.stateSnapshots.getGenesisSnapshotByForkId(
                  forkId
              )?.hash || ethers.ZeroHash;
    }

    public async getOnChainSnapshotHash(channelId?: Hash): Promise<Hash> {
        const id = channelId ?? this.harness.channelId;
        return StateSnapshot.from(
            await this.harness.channelManager.getStateSnapshot(id)
        ).hash;
    }

    public async getLocalStateSnapshot(peer: TestPeer): Promise<StateSnapshot> {
        const handle = this.harness.getPeerHandle(peer.index);
        const struct = await handle.queryLocalStateSnapshot(
            this.harness.channelId as string
        );
        return StateSnapshot.from(struct as StateSnapshotStruct);
    }
    /**
     * Get the next peer that should write a block
     */
    async getNextPeerToWrite(): Promise<TestPeer> {
        try {
            const forkId = this.harness.activeForkId;
            if (!forkId) {
                throw new Error("getNextPeerToWrite: no active fork ID");
            }

            const sourcePeer = await this.harness.peerWithHighestBlock(forkId);
            const sourceHandle = this.harness.getPeerHandle(sourcePeer.index);
            const nextAddress = await sourceHandle.queryNextToWrite();

            this.logger.verbose(`getNextPeerToWrite returned: ${nextAddress}`);

            const nextPeer = this.harness.peers.find(
                (peer) => peer.address === nextAddress
            );
            if (!nextPeer) {
                const peerAddresses = this.harness.peers.map((p) => p.address);

                const participantStates = await Promise.all(
                    this.harness.peers.map(async (_peer, i) => {
                        try {
                            const participants = await this.harness
                                .getPeerHandle(i)
                                .queryParticipants();
                            return `Peer ${i}: ${participants.length} participants`;
                        } catch {
                            return `Peer ${i}: error getting participants`;
                        }
                    })
                );

                throw new Error(
                    `No peer found with address ${nextAddress}. Available peers: ${peerAddresses.join(", ")}. Participant states: ${participantStates.join(", ")}`
                );
            }

            return nextPeer;
        } catch (error) {
            this.logger.error(`getNextPeerToWrite failed: ${error}`);
            throw error;
        }
    }

    /**
     * Wait for transport connection to be established between two peers
     */
    async waitForPeerTransport(
        fromPeerIndex: number,
        toPeerIndex: number,
        timeoutMs: number = 5000
    ): Promise<ATransport> {
        let resolvedTransport: ATransport | undefined;

        const condition = () => {
            const transport = this.getTransport(fromPeerIndex, toPeerIndex);

            if (transport) {
                resolvedTransport = transport;
                return true;
            }

            return false;
        };

        if (condition()) {
            return resolvedTransport!;
        }

        await this.harness.connectionBarrier.waitFor(condition, {
            timeoutMs,
            timeoutMessage: `Transport from peer ${fromPeerIndex} to peer ${toPeerIndex} not available within ${timeoutMs}ms`
        });
        return resolvedTransport!;
    }

    /**
     * Get the transport in fromPeerIndex p2pManager towards toPeerIndex
     */
    getTransport(
        fromPeerIndex: number,
        toPeerIndex: number
    ): ATransport | undefined {
        const fromPeer = this.harness.getPeer(fromPeerIndex);
        const toPeer = this.harness.getPeer(toPeerIndex);

        return fromPeer.stateManager.p2pManager.openConnections.find((t) => {
            const profile =
                fromPeer.stateManager.p2pManager.profileManager.getProfileByTransport(
                    t
                );
            return profile?.evmAddress === toPeer.address;
        });
    }

    /**
     * Get the number of open connections for a peer
     */
    async getConnectionCount(peerIndex: number): Promise<number> {
        return this.harness
            .getPeerHandle(peerIndex)
            .queryInternals.connectionCount();
    }

    /**
     * Get peer profile by EVM address
     */
    getProfile(
        peerIndex: number,
        options?: { evmAddress?: Address; transport?: ATransport }
    ): PeerProfile | undefined {
        const { evmAddress, transport } = options || {};
        const peer = this.harness.getPeer(peerIndex);
        if (!evmAddress && !transport) {
            throw new Error(
                "Either evmAddress or transport must be provided to getProfile"
            );
        }
        if (transport) {
            return peer.stateManager.p2pManager.profileManager.getProfileByTransport(
                transport
            );
        }
        if (evmAddress) {
            return peer.stateManager.p2pManager.profileManager.getProfileByEvmAddress(
                evmAddress
            );
        }
        return undefined;
    }

    async getDisputeHashes(options?: {
        peerIndices?: number[];
        disputedForkId?: ForkId;
    }): Promise<Hash[]> {
        const { peerIndices, disputedForkId } = options || {};
        const peers = this.harness.getFilteredOrHonestPeers(peerIndices);

        const forkId = disputedForkId ?? this.harness.activeForkId;
        if (!forkId) {
            throw new Error(
                "No fork ID available to query dispute commitments"
            );
        }

        const disputeHashes = new Set<Hash>();

        const disputeWindowsByPeer = (await Promise.all(
            peers.map((peer) => {
                return this.harness
                    .localDiamondView(peer.index)
                    .getDisputeWindows(this.harness.channelId!, [forkId]);
            })
        )) as Array<
            Array<{ evidence: { disputeCommitments: Hash[] } } | undefined>
        >;

        for (const disputeWindows of disputeWindowsByPeer) {
            const disputeWindow = disputeWindows[0];
            if (!disputeWindow) continue;

            for (const disputeCommitment of disputeWindow.evidence
                .disputeCommitments) {
                disputeHashes.add(disputeCommitment as Hash);
            }
        }

        return Array.from(disputeHashes);
    }
}
