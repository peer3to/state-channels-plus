import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import type { HarnessControlRpc } from "@test/fixtures/customRpc/harnessControl/HarnessControlRpc";
import type { TestPeer } from "@test/harness/core/types";
import { Codec, Logger, Type } from "@/utils";
import { ForkId, Hash } from "@/types/types";
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
export class StateQueryActions<
    TCustomRpc extends HarnessControlRpc = HarnessControlRpc
> {
    constructor(
        private harness: PeerTestHarness<TCustomRpc>,
        private logger: Logger
    ) {}

    /**
     * Get the latest state machine state hash for a peer - ONLY if it exists in storage
     */
    public async getLatestStateMachineStateHash(
        peerIndex: number
    ): Promise<Hash | null> {
        const peer = this.harness.getPeer(peerIndex);
        const forkId = this.harness.activeForkId;
        if (!forkId) return null;
        return await this.harness
            .control(peer)
            .query.getLatestStateMachineStateHash(forkId)
            .request();
    }

    /** On-chain kill-period state for `forkId`, as seen by `peerIndex`. */
    public async killPeriod(forkId: ForkId, peerIndex: number = 0) {
        return await this.harness
            .control(this.harness.getPeer(peerIndex))
            .dispute.getKillPeriod(forkId)
            .request();
    }

    /** Participants slashed on-chain, lowercased, as seen by `peerIndex`. */
    public async onChainSlashedParticipants(
        peerIndex: number = 0
    ): Promise<string[]> {
        return await this.harness
            .control(this.harness.getPeer(peerIndex))
            .query.getOnChainSlashedParticipants()
            .request();
    }

    public async getOnChainSnapshotHash(channelId?: Hash): Promise<Hash> {
        const id = channelId ?? this.harness.channelId;
        return StateSnapshot.from(
            await this.harness.channelManager.getStateSnapshot(id)
        ).hash;
    }

    public async getLocalStateSnapshot(
        peer: TestPeer<TCustomRpc>
    ): Promise<StateSnapshot> {
        const { encodedSnapshot } = await this.harness
            .control(peer)
            .query.getLocalStateSnapshotStruct()
            .request();
        return StateSnapshot.from(
            Codec.decode(encodedSnapshot, Type.StateSnapshot)
        );
    }
    /**
     * Get the next peer that should write a block
     */
    async getNextPeerToWrite(): Promise<TestPeer<TCustomRpc>> {
        try {
            const forkId = this.harness.activeForkId;
            if (!forkId) {
                throw new Error("getNextPeerToWrite: no active fork ID");
            }

            const sourcePeer = await this.harness.peerWithHighestBlock(forkId);

            const nextAddress = await this.harness
                .control(sourcePeer)
                .query.getNextToWrite()
                .request();

            this.logger.verbose(`getNextPeerToWrite returned: ${nextAddress}`);

            const nextPeer = this.harness.peers.find(
                (peer) => peer.address === nextAddress
            );
            if (!nextPeer) {
                // Enhanced error reporting (all host-side queries).
                const peerAddresses = this.harness.peers.map((p) => p.address);
                const stateHash = await this.getLatestStateMachineStateHash(0);
                const latestBlockHeight = await this.harness
                    .control(sourcePeer)
                    .query.getLatestBlockHeight(forkId)
                    .request();

                const participantStates = await Promise.all(
                    this.harness.peers.map(async (peer, i) => {
                        try {
                            const participants = await this.harness
                                .control(peer)
                                .query.getParticipants()
                                .request();
                            return `Peer ${i}: ${participants.length} participants`;
                        } catch {
                            return `Peer ${i}: error getting participants`;
                        }
                    })
                );

                throw new Error(
                    `No peer found with address ${nextAddress}. Available peers: ${peerAddresses.join(", ")}. ForkId: ${forkId}, StateHash: ${stateHash ?? "none"}, LatestBlockHeight: ${latestBlockHeight ?? "none"}. Participant states: ${participantStates.join(", ")}`
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
        const peer = this.harness.getPeer(peerIndex);
        return await this.harness
            .control(peer)
            .query.getOpenConnectionCount()
            .request();
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

        const commitmentsByPeer = await Promise.all(
            peers.map((peer) =>
                this.harness
                    .control(peer)
                    .query.getDisputeWindowCommitments(forkId)
                    .request()
            )
        );

        for (const commitments of commitmentsByPeer) {
            for (const commitment of commitments) {
                disputeHashes.add(commitment as Hash);
            }
        }

        return Array.from(disputeHashes);
    }
}
