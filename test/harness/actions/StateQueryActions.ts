import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import type { TestPeer } from "@test/harness/core/types";
import { Logger } from "@/utils";
import { Address, BlockHeight, ForkId, Hash } from "@/types/types";
import { Status } from "@/types/flags";
import { ATransport } from "@/transport";
import PeerProfile from "@/PeerProfile";
import { ethers } from "@/index";
import Block from "@/models/Block";
import { StateSnapshot } from "@/models";

/**
 * StateQueryActions handles all read-only state queries.
 * Responsibilities:
 * - Query state machine state
 * - Query network/transport state
 * - Query dispute/timeout state
 * - Determine next peer to write
 *
 * NO MUTATIONS - read-only operations only
 */
export class StateQueryActions {
    constructor(
        private harness: PeerTestHarness,
        private logger: Logger
    ) {}

    public getPeerStorage(peerIndex: number) {
        const peer = this.harness.getPeer(peerIndex);
        return peer.stateManager.storage;
    }

    /**
     * Get the latest state machine state hash for a peer - ONLY if it exists in storage
     */
    public getLatestStateMachineStateHash(peerIndex: number): Hash | null {
        const peer = this.harness.getPeer(peerIndex);
        const storage = peer.stateManager.storage;
        if (!peer) throw new Error(`Peer ${peerIndex} not found`);

        const latestBlock = storage.blocks.getLatestBlock(
            this.harness.activeForkId!
        );
        if (!latestBlock) return null;

        const latestStateSnapshot =
            storage.stateSnapshots.getStateSnapshotByHash(
                latestBlock.stateSnapshotHash
            );
        if (!latestStateSnapshot) return null;

        const latestStateMachineState =
            storage.stateMachineStates.getStateMachineState(
                latestStateSnapshot.stateMachineStateHash
            );
        if (!latestStateMachineState) return null;

        return latestStateSnapshot.stateMachineStateHash; // return the hash if the state exists
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

    public async getLocalStateSnapshot(peer: TestPeer): Promise<StateSnapshot> {
        const stateManager = peer.stateManager;
        const localDiamond =
            stateManager.diamondStateMachine.localDiamondContract;
        return StateSnapshot.from(
            await localDiamond.getStateSnapshot(stateManager.channelId)
        );
    }
    /**
     * Get the next peer that should write a block
     */
    async getNextPeerToWrite(): Promise<TestPeer> {
        try {
            // Find the first participating peer to query
            const participatingPeer = this.harness.peers.find(
                (peer) => peer.stateManager.getStatus() === Status.PARTICIPATING
            )!;

            const nextAddress =
                await participatingPeer.stateManager.diamondStateMachine.getNextToWrite();

            this.logger.verbose(`getNextPeerToWrite returned: ${nextAddress}`);

            const nextPeer = this.harness.peers.find(
                (peer) => peer.address === nextAddress
            );
            if (!nextPeer) {
                // Enhanced error reporting
                const stateHash = this.getLatestStateMachineStateHash(0);
                const peerAddresses = this.harness.peers.map((p) => p.address);

                const latestBlock =
                    participatingPeer.stateManager.storage.blocks.getLatestBlock(
                        this.harness.activeForkId!
                    );
                const forkId = participatingPeer.stateManager.forkId;

                // Check participants on all peers for diagnostics
                const participantStates = await Promise.all(
                    this.harness.peers.map(async (peer, i) => {
                        try {
                            const participants =
                                await peer.stateManager.diamondStateMachine.getParticipants();
                            return `Peer ${i}: ${participants.length} participants`;
                        } catch {
                            return `Peer ${i}: error getting participants`;
                        }
                    })
                );

                throw new Error(
                    `No peer found with address ${nextAddress}. Available peers: ${peerAddresses.join(", ")}. ForkId: ${forkId}, StateHash: ${stateHash ?? "none"}, LatestBlockHeight: ${latestBlock?.height ?? "none"}. Participant states: ${participantStates.join(", ")}`
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

        // Check immediately first
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
    getConnectionCount(peerIndex: number): number {
        const peer = this.harness.getPeer(peerIndex);
        return peer.stateManager.p2pManager.openConnections.length;
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

        const disputeWindowsByPeer = await Promise.all(
            peers.map((peer) => {
                const localDiamond = this.harness.getLocalDiamond(peer.index);
                return localDiamond.getDisputeWindows(this.harness.channelId, [
                    forkId
                ]);
            })
        );

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
