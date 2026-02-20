import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import type { TestPeer } from "@test/harness/core/types";
import { Logger } from "@/utils";
import { Address, BlockHeight, ForkId, Hash } from "@/types/types";
import { ATransport } from "@/transport";
import PeerProfile from "@/PeerProfile";
import { ethers } from "@/index";
import Block from "@/models/Block";
import type { EventBarrierCapturedError } from "@/utils/EventBarrier";

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

    /**
     * Get the latest state machine state hash for a peer - ONLY if it exists in storage
     */
    public getLatestStateMachineStateHash(peerIndex: number): Hash | null {
        const peer = this.harness.peers[peerIndex];
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

    /**
     * Get the next peer that should write a block
     */
    async getNextPeerToWrite(): Promise<TestPeer> {
        try {
            const nextAddress =
                await this.harness.peers[0].stateManager.diamondStateMachine.getNextToWrite();

            this.logger.verbose(`getNextPeerToWrite returned: ${nextAddress}`);

            const nextPeer = this.harness.peers.find(
                (peer) => peer.address === nextAddress
            );
            if (!nextPeer) {
                // Enhanced error reporting
                const stateHash = this.getLatestStateMachineStateHash(0);
                const peerAddresses = this.harness.peers.map((p) => p.address);

                const latestBlock =
                    this.harness.peers[0].stateManager.storage.blocks.getLatestBlock(
                        this.harness.activeForkId!
                    );
                const forkId = this.harness.peers[0].stateManager.forkId;

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
        const fromPeer = this.harness.getPeer(fromPeerIndex);
        const toPeer = this.harness.getPeer(toPeerIndex);
        let resolvedTransport: ATransport | undefined;

        const condition = () => {
            const transport =
                fromPeer.stateManager.p2pManager.openConnections.find((t) => {
                    const profile =
                        fromPeer.stateManager.p2pManager.profileManager.getProfileByTransport(
                            t
                        );
                    return profile?.evmAddress === toPeer.address;
                });

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

        // Use connection barrier for event-driven waiting
        try {
            await this.harness.connectionBarrier.waitFor(condition, {
                timeoutMs,
                timeoutMessage: `Transport from peer ${fromPeerIndex} to peer ${toPeerIndex} not available within ${timeoutMs}ms`
            });
            return resolvedTransport!;
        } catch (error) {
            const barrierError = error as EventBarrierCapturedError;
            this.logger.error("waitForPeerTransport waitFor failed", {
                error,
                capturedBarrierStack: barrierError.capturedBarrierStack,
                fromPeerIndex,
                toPeerIndex,
                timeoutMs
            });
            const wrappedError = new Error(
                `Transport from peer ${fromPeerIndex} to peer ${toPeerIndex} not available within ${timeoutMs}ms`
            ) as EventBarrierCapturedError;
            wrappedError.capturedBarrierStack =
                barrierError.capturedBarrierStack;
            throw wrappedError;
        }
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
        evmAddress: Address
    ): PeerProfile | undefined {
        const peer = this.harness.getPeer(peerIndex);
        return peer.stateManager.p2pManager.profileManager.getProfileByEvmAddress(
            evmAddress
        );
    }
}
