import { ARpcService } from "@/rpc";
import { ChannelId, ForkId, Timestamp } from "@/types/types";
import ATransport from "@/transport/ATransport";
import P2PManager from "@/P2PManager";
import SpectateService, { SyncPayload } from "../spectate/SpectateService";
import ARpcMethods from "@/rpc/ARpcMethods";
import { StateSnapshot } from "@/models";

class ForkProofService extends ARpcService<ARpcMethods> {
    forkProofInitTimes: WeakMap<
        ATransport,
        { time: number; myForkId: ForkId; peerForkId: ForkId }
    > = new WeakMap<
        ATransport,
        { time: number; myForkId: ForkId; peerForkId: ForkId }
    >();

    spectateService: SpectateService;

    constructor(p2pManager: P2PManager, spectateService: SpectateService) {
        super(p2pManager);
        this.spectateService = spectateService;
    }

    public createRPCMethods(transport: ATransport) {
        const ForkProofRpcMethodsClass =
            require("./ForkProofRpcMethods").default;
        return new ForkProofRpcMethodsClass(transport, this);
    }

    /**
     * Determine the canonical (correct) fork by querying on-chain state
     * Traverses dispute windows to find the non-disputed fork
     */
    public async determineCanonicalFork(channelId: ChannelId): Promise<ForkId> {
        const stateChannelManagerContract =
            this.p2pManager.stateManager.stateChannelManagerContract;
        const diamondStateMachine =
            this.p2pManager.stateManager.diamondStateMachine;

        // Get current on-chain snapshot
        const onChainSnapshot =
            await stateChannelManagerContract.getStateSnapshot(channelId);
        let currentForkId = onChainSnapshot.forkId;

        // Traverse through disputed forks to find the canonical one
        let isDisputed = await stateChannelManagerContract.isForkDisputed(
            channelId,
            currentForkId
        );

        while (isDisputed) {
            // Check if this fork has been reduced
            const isReduced =
                await diamondStateMachine.localDiamondContract.isReduceChallengePeriodExpired(
                    channelId,
                    currentForkId
                );

            if (!isReduced) {
                // Not reduced yet, current fork is still canonical
                break;
            }

            // Get the reduced fork
            const disputeWindows =
                await stateChannelManagerContract.getDisputeWindows(channelId, [
                    currentForkId
                ]);

            if (
                disputeWindows.length === 0 ||
                !disputeWindows[0].reducedResult.forkId
            ) {
                // No reduction found, current fork is canonical
                break;
            }

            currentForkId = disputeWindows[0].reducedResult.forkId;
            isDisputed = await stateChannelManagerContract.isForkDisputed(
                channelId,
                currentForkId
            );
        }

        return currentForkId as ForkId;
    }

    /**
     * Challenge peer to prove their fork
     * Call this whenever you queue a block - if they can prove their fork is canonical, sync to them
     * If they can't prove it or it's not canonical, disconnect
     *
     * @param transport The peer's transport
     * @param channelId The channel ID
     * @param peerForkId The peer's fork ID (from the block they sent)
     */
    public challengePeerFork(
        transport: ATransport,
        channelId: ChannelId,
        peerForkId: ForkId
    ) {
        console.log(`Challenging peer to prove their fork ${peerForkId}`);
        const time = Date.now();
        const myForkId = this.p2pManager.stateManager.forkId;

        // Store the init time and fork IDs for verification
        this.forkProofInitTimes.set(transport, { time, myForkId, peerForkId });

        (this.remoteRpc.forkProofService as any)
            .onProveForkRequest(channelId, peerForkId, time)
            .sendOne(transport);

        // Timeout if they don't respond
        setTimeout(() => {
            if (this.forkProofInitTimes.has(transport)) {
                console.log(
                    `Peer failed to prove fork ${peerForkId}, disconnecting`
                );
                this.p2pManager.disconnectAndBlacklistPeer(transport);
                this.forkProofInitTimes.delete(transport);
            }
        }, this.p2pManager.stateManager.timeConfig.agreementTime * 1000);
    }

    /**
     * Generate sync payload for our current fork (reuses spectate logic)
     */
    public async generateForkProofPayload(
        channelId: ChannelId
    ): Promise<SyncPayload> {
        return await this.spectateService.generateSyncPayload(channelId);
    }

    /**
     * Verify that the provided proof is for the challenged fork and is valid
     */
    public async verifyPeerForkProof(
        channelId: ChannelId,
        syncPayload: SyncPayload,
        expectedPeerForkId: ForkId
    ): Promise<{ isValid: boolean; isCanonical: boolean }> {
        // First check: Does the proof match the fork we challenged them on?
        if (
            syncPayload.latestForkGenesisSnapshot.forkId !== expectedPeerForkId
        ) {
            console.log(
                `Proof fork mismatch: expected ${expectedPeerForkId}, got ${syncPayload.latestForkGenesisSnapshot.forkId}`
            );
            return { isValid: false, isCanonical: false };
        }

        // Second check: Verify this is the canonical fork according to chain
        const canonicalForkId = await this.determineCanonicalFork(channelId);
        const isCanonical = expectedPeerForkId === canonicalForkId;

        if (!isCanonical) {
            console.log(
                `Peer proved ${expectedPeerForkId} but canonical fork is ${canonicalForkId}`
            );
            return { isValid: true, isCanonical: false };
        }

        return { isValid: true, isCanonical: true };
    }

    public didRespond(transport: ATransport): boolean {
        return !this.forkProofInitTimes.has(transport);
    }
}

export default ForkProofService;
