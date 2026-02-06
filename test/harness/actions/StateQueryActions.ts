import { PeerTestHarness, TestPeer } from "@test/fixtures/PeerTestHarness";
import { Logger } from "@/utils";
import { ForkId, Address } from "@/types/types";
import { TimeoutStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { ATransport } from "@/transport";
import PeerProfile from "@/PeerProfile";
import { AStateMachine } from "@typechain-types";
import type { RpcServiceFactoryMap } from "@/rpc/registry";

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
        private harness: PeerTestHarness<any, any>,
        private logger: Logger
    ) {}

    /**
     * Get the state machine state for a peer
     */
    getStateMachineState(peerIndex: number, forkId: ForkId): any {
        const peer = this.harness.peers[peerIndex];
        if (!peer) throw new Error(`Peer ${peerIndex} not found`);

        const latestBlock =
            peer.stateManager.storage.blocks.getLatestBlock(forkId);
        if (!latestBlock) {
            const genesisSnapshot =
                peer.stateManager.storage.stateSnapshots.getGenesisSnapshotByForkId(
                    forkId
                );
            return genesisSnapshot ? "genesis" : null;
        }

        const stateSnapshot =
            peer.stateManager.storage.stateSnapshots.getStateSnapshotByHash(
                latestBlock.stateSnapshotHash
            );
        return stateSnapshot ? stateSnapshot.snapshotData : null;
    }

    /**
     * Get the state machine state hash for a peer
     */
    private getStateMachineStateHash(peerIndex: number): string | null {
        const peer = this.harness.peers[peerIndex];
        if (!peer) throw new Error(`Peer ${peerIndex} not found`);

        const latestBlock = peer.stateManager.storage.blocks.getLatestBlock(
            this.harness.activeForkId!
        );
        if (!latestBlock) return null;

        return latestBlock.stateSnapshotHash?.toString() || null;
    }

    /**
     * Get the next peer that should write a block
     */
    async getNextPeerToWrite(): Promise<
        TestPeer<AStateMachine, RpcServiceFactoryMap>
    > {
        try {
            const nextAddress =
                await this.harness.peers[0].stateManager.diamondStateMachine.getNextToWrite();

            this.logger.verbose(`getNextPeerToWrite returned: ${nextAddress}`);

            const nextPeer = this.harness.peers.find(
                (peer) => peer.address === nextAddress
            );
            if (!nextPeer) {
                // Enhanced error reporting
                const stateHash = this.getStateMachineStateHash(0);
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
            throw new Error(
                `Transport from peer ${fromPeerIndex} to peer ${toPeerIndex} not available within ${timeoutMs}ms`
            );
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
