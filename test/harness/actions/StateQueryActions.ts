import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import type { PeerHandle } from "@test/harness/core/PeerHandle";
import { Logger } from "@/utils";
import { ForkId, Hash } from "@/types/types";
import { StateSnapshot } from "@/models";

/**
 * StateQueryActions handles all read-only state queries.
 * NO MUTATIONS - read-only operations only.
 */
export class StateQueryActions {
    constructor(
        private harness: PeerTestHarness,
        private logger: Logger
    ) {}

    /**
     * Get the latest state machine state hash for a peer - ONLY if it exists in storage
     */
    public async getLatestStateMachineStateHash(
        peerIndex: number
    ): Promise<Hash | null> {
        const forkId = this.harness.activeForkId;
        if (!forkId) return null;
        const handle = this.harness.getPeerHandle(peerIndex);
        const hash =
            await handle.stateMachine.queryLatestStateMachineStateHash(forkId);
        return hash as Hash | null;
    }

    public async getOnChainSnapshotHash(channelId?: Hash): Promise<Hash> {
        const id = channelId ?? this.harness.channelId;
        return StateSnapshot.from(
            await this.harness.channelManager.getStateSnapshot(id)
        ).hash;
    }

    public async getLocalStateSnapshot(
        peer: PeerHandle
    ): Promise<StateSnapshot> {
        const struct = await peer.snapshots.queryLocalStateSnapshot(
            this.harness.channelId as string
        );
        return StateSnapshot.from(struct);
    }
    /**
     * Get the next peer that should write a block
     */
    async getNextPeerToWrite(): Promise<PeerHandle> {
        try {
            const forkId = this.harness.activeForkId;
            if (!forkId) {
                throw new Error("getNextPeerToWrite: no active fork ID");
            }

            const sourcePeer = await this.harness.peerWithHighestBlock(forkId);
            const nextAddress = await sourcePeer.channel.queryNextToWrite();

            this.logger.verbose(`getNextPeerToWrite returned: ${nextAddress}`);

            const nextPeer = this.harness.peerHandles.find(
                (peer) => peer.address === nextAddress
            );
            if (!nextPeer) {
                const peerAddresses = this.harness.peerHandles.map(
                    (p) => p.address
                );

                const participantStates = await Promise.all(
                    this.harness.peerHandles.map(async (_peer, i) => {
                        try {
                            const participants = await this.harness
                                .getPeerHandle(i)
                                .channel.queryParticipants();
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
     * Get the number of open connections for a peer
     */
    async getConnectionCount(peerIndex: number): Promise<number> {
        return this.harness
            .getPeerHandle(peerIndex)
            .queryInternals.connectionCount();
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
                return this.harness
                    .localDiamondView(peer.index)
                    .getDisputeWindows(this.harness.channelId!, [forkId]);
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
