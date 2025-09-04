import { ARpcService, MainRpcService } from "@/rpc";
import { ChannelId, Timestamp } from "@/types/types";
import { StateSnapshot } from "@/models";
import Clock from "@/Clock";
import ATransport from "@/transport/ATransport";
import {
    MilestoneProofStruct,
    StateProofStruct
} from "@typechain-types/contracts/V1/types/ProofTypes";
import { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { Codec, Type } from "@/utils";

export interface SnapshotPayload {
    disputeWindows: DisputeStruct[];
    stateProof: StateProofStruct;
}

class SpectateService extends ARpcService {
    constructor(mainRpcService: MainRpcService) {
        super(mainRpcService);
    }

    // Called locally to initiate spectate sync
    public spectateSync(transport: ATransport, channelId: ChannelId) {
        console.log("spectateSync !");
        let time = Clock.getTimeInSeconds();
        this.mainRpcService.rpcProxy
            .onSpectateRequest(channelId, time)
            .sendOne(transport);
    }

    public async onSpectateRequest(channelId: ChannelId, time: Timestamp) {
        let localTime = Clock.getTimeInSeconds();
        if (
            Math.abs(time - localTime) >
            this.mainRpcService.p2pManager.stateManager.timeConfig.agreementTime
        ) {
            console.log(
                `onSpectateRequest - time difference too big - time:${time} localTime:${localTime} diff:${
                    time - localTime
                } aggreeTime:${
                    this.mainRpcService.p2pManager.stateManager.timeConfig
                        .agreementTime
                }`
            );
            return;
        }
        console.log(`onSpectateRequest - localTime:${localTime} time:${time}`);

        // Generate payload to prove the latest possible snapshot
        // (but don't send it on-chain - send it to the spectator)
        const snapshotPayload = await this.generateSnapshotPayload(channelId);

        console.log(`onSpectateRequest - done`);
        this.mainRpcService.rpcProxy
            .onSpectateResponse(channelId, snapshotPayload, localTime)
            .sendOne(this.mainRpcService.senderTransport!);
    }

    public async onSpectateResponse(
        channelId: ChannelId,
        snapshotPayload: SnapshotPayload,
        responseTime: Timestamp
    ) {
        console.log(`onSpectateResponse - start`);
        let localTime = Clock.getTimeInSeconds();
        let rtt = localTime - responseTime;
        if (
            rtt >
            this.mainRpcService.p2pManager.stateManager.timeConfig.agreementTime
        ) {
            console.log("onSpectateResponse - RTT too high, ignoring");
            return;
        }

        // Fetch latest on-chain snapshot from RPC node
        const onChainSnapshot = await this.fetchOnChainSnapshot(channelId);

        // Run the payload in local EVM to verify it
        const verificationResult = await this.verifyPayload(
            channelId,
            onChainSnapshot,
            snapshotPayload
        );

        if (!verificationResult.isValid) {
            console.warn(
                "Payload verification failed:",
                verificationResult.error
            );
            return;
        }

        // If successful, spectator is 'synced' to latest proven state
        await this.syncToLatestProvenState(
            channelId,
            verificationResult.provenState
        );

        // Try to apply blocks from queue in blockConfirmationPipeline
        await this.applyQueuedBlocksFromPipeline(channelId);

        console.log("Spectator successfully synced to latest proven state");
    }

    /**
     * Generate payload to prove the latest possible snapshot
     * (but don't send it on-chain - send it to the spectator)
     */
    private async generateSnapshotPayload(
        channelId: ChannelId
    ): Promise<SnapshotPayload> {
        const stateManager = this.mainRpcService.p2pManager.stateManager;
        const agreementManager = stateManager.agreementManager;

        // Get the current fork ID
        const forkId = stateManager.forkId;

        const latestBlockHeight =
            stateManager.storage.blocks.getNextBlockHeight(forkId) - 1;

        // Get the latest state proof data
        const latestStateProof = await agreementManager.getStateProof(
            forkId,
            latestBlockHeight
        );

        const disputeWindows: DisputeStruct[] = [];

        // Get the latest fork genesis snapshot to include in the payload
        const latestForkGenesisSnapshot =
            stateManager.storage.stateSnapshots.getGenesisSnapshotDataByForkId(
                forkId
            );
        if (!latestForkGenesisSnapshot) {
            throw new Error(`No genesis snapshot found for fork ${forkId}`);
        }

        // Check if we have disputes and commitments for this fork
        const isDisputed =
            await stateManager.stateChannelManagerContract.isForkDisputed(
                channelId,
                forkId
            );
        const disputeCommitments = isDisputed
            ? await stateManager.stateChannelManagerContract.getWindowCommitments(
                  channelId,
                  forkId
              )
            : [];

        if (
            !isDisputed ||
            !disputeCommitments ||
            disputeCommitments.length === 0
        ) {
            // No disputes or commitments available, keep empty arrays
            return {
                disputeWindows,
                stateProof: latestStateProof
            };
        }

        // Build disputes from local storage confirmations
        for (const commitment of disputeCommitments) {
            const confirmation =
                stateManager.storage.disputes.getDisputeConfirmation(
                    commitment
                );
            if (!confirmation) {
                throw new Error(
                    `Missing Data Availability for dispute commitment ${commitment}`
                );
            }
            const dispute = Codec.decode(
                confirmation.signedDispute.encodedDispute,
                Type.Dispute
            ) as DisputeStruct;
            disputeWindows.push(dispute);
        }

        console.log(
            `Generated ${disputeWindows.length} disputes for fork ${forkId}`
        );

        if (!latestForkGenesisSnapshot) {
            throw new Error(`No genesis snapshot found for fork ${forkId}`);
        }

        return {
            disputeWindows,
            stateProof: latestStateProof
        };
    }

    /**
     * Fetch latest on-chain snapshot from RPC node
     */
    private async fetchOnChainSnapshot(
        channelId: ChannelId
    ): Promise<StateSnapshot> {
        // Fetch the latest on-chain snapshot from RPC node
        // Assume it's true since it's on-chain
        const currentOnChainSnapshot = StateSnapshot.from(
            await this.mainRpcService.p2pManager.stateManager.stateChannelManagerContract.getStateSnapshot(
                channelId
            )
        );
        return currentOnChainSnapshot;
    }

    /**
     * Run the payload in local EVM to verify it
     */
    private async verifyPayload(
        channelId: ChannelId,
        onChainSnapshot: StateSnapshot,
        snapshotPayload: SnapshotPayload
    ): Promise<{ isValid: boolean; error?: string; provenState?: any }> {
        try {
            const stateManager = this.mainRpcService.p2pManager.stateManager;

            // Start with on-chain snapshot and traverse dispute windows until we reach the latest fork
            let currentForkId = onChainSnapshot.forkId;
            let isDisputed =
                await stateManager.stateChannelManagerContract.isForkDisputed(
                    channelId,
                    currentForkId
                );

            while (isDisputed) {
                // Check if reduced result already exists on-chain
                const existingReducedResult =
                    await stateManager.stateChannelManagerContract.getReducedResult(
                        channelId,
                        currentForkId
                    );
                if (existingReducedResult[0]) {
                    // Traverse to the reduced fork
                    currentForkId = existingReducedResult[0];
                    isDisputed =
                        await stateManager.stateChannelManagerContract.isForkDisputed(
                            channelId,
                            currentForkId
                        );
                    continue;
                }

                // No existing reduced result, use the disputes provided by participant
                if (snapshotPayload.disputeWindows.length > 0) {
                    const creationTimestamp =
                        await stateManager.stateChannelManagerContract.getDisputeWindowCreationTimestamp(
                            channelId,
                            currentForkId
                        );

                    // Use proxy view to compute reduced output cheaply (same as StateManager)
                    const reducedOutput =
                        await stateManager.stateChannelManagerContract.reduceProxyView(
                            snapshotPayload.disputeWindows,
                            creationTimestamp
                        );
                    console.log(
                        `Computed reduced output locally: forkGenesisTimestamp=${reducedOutput.forkGenesisTimestamp}`
                    );

                    // The reduced output gives us the next fork ID to traverse to
                    // We can derive the fork ID from the reduced output's latest block
                    const nextForkId =
                        reducedOutput.latestBlock.stateSnapshotHash;
                    currentForkId = nextForkId;
                    isDisputed =
                        await stateManager.stateChannelManagerContract.isForkDisputed(
                            channelId,
                            currentForkId
                        );
                } else {
                    // No disputes provided, can't proceed
                    return {
                        isValid: false,
                        error: "No disputes provided for disputed fork"
                    };
                }
            }

            // Get the computed latest fork genesis snapshot
            const computedLatestForkGenesisSnapshot =
                stateManager.storage.stateSnapshots.getGenesisSnapshotDataByForkId(
                    currentForkId
                );
            if (!computedLatestForkGenesisSnapshot) {
                return {
                    isValid: false,
                    error: `No genesis snapshot found for computed fork ${currentForkId}`
                };
            }

            console.log(
                `Computed fork genesis snapshot: forkId=${computedLatestForkGenesisSnapshot.forkId}`
            );

            // Verify state proof to prove the latest state from the proven fork
            if (snapshotPayload.stateProof.milestones.length > 0) {
                console.log(`Verifying state proof from proven fork`);

                // Get the latest state proof from the proven fork to compare with participant's state proof
                const latestBlockHeight =
                    stateManager.storage.blocks.getNextBlockHeight(
                        currentForkId
                    ) - 1;
                const computedStateProof =
                    await stateManager.agreementManager.getStateProof(
                        currentForkId,
                        latestBlockHeight
                    );

                // Compare the state proof objects directly
                if (
                    computedStateProof.milestones.length !==
                    snapshotPayload.stateProof.milestones.length
                ) {
                    return {
                        isValid: false,
                        error: "State proof milestone count mismatch"
                    };
                }

                console.log(
                    `Verified state proof matches computed state proof`
                );
            }

            // Return the proven fork genesis snapshot as the proven state
            return {
                isValid: true,
                provenState: computedLatestForkGenesisSnapshot
            };
        } catch (error) {
            console.error("Failed to verify payload in local EVM:", error);
            return {
                isValid: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    /**
     * Sync to the latest proven state
     */
    private async syncToLatestProvenState(
        channelId: ChannelId,
        provenState: StateSnapshot
    ) {
        const stateManager = this.mainRpcService.p2pManager.stateManager;

        console.log(`Syncing to latest proven state for channel ${channelId}`);

        // Update the local state to match the proven state
        // This involves updating the local storage with the proven snapshot
        try {
            // Store the proven state snapshot in local storage
            // This ensures the spectator has the same state as participants
            stateManager.storage.stateSnapshots.storeStateSnapshot(
                provenState,
                { hash: provenState.hash }
            );

            // Update the fork ID to match the proven state
            stateManager.forkId = provenState.forkId;

            console.log(
                `Successfully synced to proven state: forkId=${provenState.forkId}, height=${provenState.blockHeight}`
            );
        } catch (error) {
            console.error("Failed to sync to proven state:", error);
            throw error;
        }
    }

    /**
     * TODO Apply blocks from queue in blockConfirmationPipeline
     */
    private async applyQueuedBlocksFromPipeline(channelId: ChannelId) {
        const stateManager = this.mainRpcService.p2pManager.stateManager;

        console.log(
            `Applying queued blocks from pipeline for channel ${channelId}`
        );

        try {
            // The spectator can now process blocks like a normal participant
            // The existing block processing pipeline will handle incoming blocks automatically
            // Since tryExecuteFromQueue is private, we'll rely on the normal block processing flow
            console.log(
                `Spectator is now ready to process blocks for channel ${channelId}`
            );

            // The spectator will automatically process blocks as they come in
            // through the normal RPC flow (onBlockConfirmation, etc.)
            // The spectator can now receive and process block confirmations like a normal participant
            // but won't be selected for leader election since they're not in the participant list

            console.log(
                "Spectator is now ready to receive and process block confirmations"
            );
        } catch (error) {
            console.error("Failed to enable block processing:", error);
            // Don't throw - this is not critical for the spectator sync process
        }
    }
}

export default SpectateService;
