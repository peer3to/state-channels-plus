import { ARpcService, MainRpcService } from "@/rpc";
import { ChannelId, Timestamp, Bytes } from "@/types/types";
import { StateSnapshot } from "@/models";
import Clock from "@/Clock";
import ATransport from "@/transport/ATransport";
import {
    MilestoneProofStruct,
    StateProofStruct
} from "@typechain-types/contracts/V1/types/ProofTypes";
import { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { Codec, Type } from "@/utils";
import { isEqual } from "lodash";

export interface SnapshotPayload {
    latestForkGenesisSnapshot: StateSnapshot;
    disputeWindows?: DisputeStruct[][];
    stateProof?: StateProofStruct;
    milestoneSnapshots?: StateSnapshot[];
    encodedState?: Bytes;
}

class SpectateService extends ARpcService {
    private spectateInitTimes: Map<ChannelId, number> = new Map();

    constructor(mainRpcService: MainRpcService) {
        super(mainRpcService);
    }

    // Called locally to initiate spectate sync
    public spectateSync(transport: ATransport, channelId: ChannelId) {
        console.log("spectateSync !");
        let time = Clock.getTimeInSeconds();

        // Store the init time for RTT calculation per channel
        this.spectateInitTimes.set(channelId, time);

        this.mainRpcService.rpcProxy
            .onSpectateRequest(channelId, time)
            .sendOne(transport);
    }

    public async onSpectateRequest(channelId: ChannelId, time: Timestamp) {
        const localTime = Clock.getTimeInSeconds();

        console.log(
            `onSpectateRequest - localTime: ${localTime}, remoteTime: ${time}`
        );

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

        const initTime = this.spectateInitTimes.get(channelId);
        if (!initTime) {
            console.log(
                "onSpectateResponse - no init time found for channel, ignoring"
            );
            return;
        }

        let localTime = Clock.getTimeInSeconds();
        let rtt = localTime - initTime;

        console.log(
            `onSpectateResponse - RTT: ${rtt}s, initTime: ${initTime}, responseTime: ${localTime}`
        );

        // If RTT is too high, disconnect from all peers
        if (
            rtt >
            this.mainRpcService.p2pManager.stateManager.timeConfig.agreementTime
        ) {
            console.log(
                `onSpectateResponse - RTT too high (${rtt}s), disconnecting from all peers`
            );
            this.mainRpcService.p2pManager.disconnectAll();
            return;
        }

        // Fetch latest on-chain snapshot from RPC node
        const onChainSnapshot = await this.fetchOnChainSnapshot(channelId);

        // Run the payload locally to verify it
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
            console.log(
                "Disconnecting from all peers due to verification failure"
            );
            this.mainRpcService.p2pManager.disconnectAll();
            this.spectateInitTimes.delete(channelId);
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

        this.spectateInitTimes.delete(channelId);
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

        // Get the latest fork genesis snapshot to include in the payload
        const latestForkGenesisSnapshot =
            stateManager.storage.stateSnapshots.getGenesisSnapshotDataByForkId(
                forkId
            );
        if (!latestForkGenesisSnapshot) {
            throw new Error(`No genesis snapshot found for fork ${forkId}`);
        }

        const latestBlockHeight =
            stateManager.storage.blocks.getNextBlockHeight(forkId) - 1;

        // Get the latest state proof data (only if there are blocks for same-fork update)
        let latestStateProof: StateProofStruct | undefined;
        let encodedState: Bytes | undefined;

        // There are blocks, so we can do a same-fork update
        latestStateProof = await agreementManager.getStateProof(
            forkId,
            latestBlockHeight
        );
        // Collect the concrete milestone snapshots for the state proof
        const milestoneSnapshots: StateSnapshot[] =
            latestStateProof.milestones.map((m) =>
                agreementManager.getSnapshot(m)
            );
        // Get the encoded state that the stateProof proves
        if (latestStateProof.milestones.length > 0) {
            const latestMilestone =
                latestStateProof.milestones[
                    latestStateProof.milestones.length - 1
                ];
            const latestSnapshot =
                agreementManager.getSnapshot(latestMilestone);
            const stateHash = latestSnapshot.snapshotData.stateMachineStateHash;
            encodedState =
                stateManager.storage.stateMachineStates.getStateMachineState(
                    stateHash
                );
            if (!encodedState) {
                throw new Error(
                    `No encoded state found for state hash ${stateHash}`
                );
            }
        }

        // Get current on-chain snapshot to start the fork traversal
        const currentOnChainSnapshot = StateSnapshot.from(
            await stateManager.stateChannelManagerContract.getStateSnapshot(
                channelId
            )
        );

        // Traverse from on-chain snapshot to latest fork, collecting disputes per dispute window
        const disputeWindows: DisputeStruct[][] = [];
        let currentForkId = currentOnChainSnapshot.forkId;
        let isDisputed =
            await stateManager.stateChannelManagerContract.isForkDisputed(
                channelId,
                currentForkId
            );

        while (isDisputed) {
            // Collect disputes for this dispute window (no on-chain shortcuts)
            const disputeCommitments =
                await stateManager.stateChannelManagerContract.getWindowCommitments(
                    channelId,
                    currentForkId
                );

            if (disputeCommitments && disputeCommitments.length > 0) {
                // Collect all disputes for this dispute window
                const currentWindowDisputes: DisputeStruct[] = [];
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
                    currentWindowDisputes.push(dispute);
                }

                disputeWindows.push(currentWindowDisputes);

                // After collecting disputes for this window, reduce to get the next fork
                const creationTimestamp =
                    await stateManager.stateChannelManagerContract.getDisputeWindowCreationTimestamp(
                        channelId,
                        currentForkId
                    );
                const reducedOutput =
                    await stateManager.stateChannelManagerContract.reduceProxyView(
                        currentWindowDisputes,
                        creationTimestamp
                    );

                // Move to the next fork based on reduce result
                currentForkId = reducedOutput.latestBlock.stateSnapshotHash;
                isDisputed =
                    await stateManager.stateChannelManagerContract.isForkDisputed(
                        channelId,
                        currentForkId
                    );
            } else {
                // No disputes available, can't proceed
                break;
            }
        }

        console.log(`Collected ${disputeWindows.length} dispute windows`);

        // Return payload with all available data
        return {
            latestForkGenesisSnapshot,
            ...(disputeWindows.length > 0 && { disputeWindows }),
            ...(latestStateProof && { stateProof: latestStateProof }),
            ...(milestoneSnapshots.length > 0 && { milestoneSnapshots }),
            ...(encodedState && { encodedState })
        };
    }

    /**
     * Fetch latest on-chain snapshot
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
     * Run the payload in locally to verify it
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
                if (
                    snapshotPayload.disputeWindows &&
                    snapshotPayload.disputeWindows.length > 0
                ) {
                    // Pop the next dispute window
                    const currentWindowDisputes =
                        snapshotPayload.disputeWindows.shift()!;

                    const creationTimestamp =
                        await stateManager.stateChannelManagerContract.getDisputeWindowCreationTimestamp(
                            channelId,
                            currentForkId
                        );

                    // Reduce only this window
                    const reducedOutput =
                        await stateManager.stateChannelManagerContract.reduceProxyView(
                            currentWindowDisputes,
                            creationTimestamp
                        );
                    console.log(
                        `Computed reduced output: forkGenesisTimestamp=${reducedOutput.forkGenesisTimestamp}`
                    );

                    // Move to next fork
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

            // Get the fork genesis snapshot from the participant's payload
            const participantProvidedSnapshot =
                snapshotPayload.latestForkGenesisSnapshot;

            // Verify that the computed fork ID matches the participant's claimed fork ID
            if (currentForkId !== participantProvidedSnapshot.forkId) {
                return {
                    isValid: false,
                    error: `Computed fork ID ${currentForkId} does not match participant provided fork ID ${participantProvidedSnapshot.forkId}`
                };
            }

            console.log(`Verified fork ID matches: ${currentForkId}`);

            // Verify state proof to prove the latest state from the proven fork
            if (
                snapshotPayload.stateProof &&
                snapshotPayload.stateProof.milestones.length > 0
            ) {
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

                // Compare the state proof objects
                if (!isEqual(computedStateProof, snapshotPayload.stateProof)) {
                    return {
                        isValid: false,
                        error: "State proof does not match computed state proof"
                    };
                }

                console.log(
                    `Verified state proof matches computed state proof`
                );

                // Verify the encoded state by generating a state proof from it and comparing
                if (snapshotPayload.encodedState) {
                    // Set the state machine to the provided encoded state
                    await stateManager.diamondStateMachine.setState(
                        snapshotPayload.encodedState
                    );

                    // Generate state proof from this encoded state
                    const generatedStateProof =
                        await stateManager.agreementManager.getStateProof(
                            currentForkId,
                            latestBlockHeight
                        );

                    // Compare with the provided state proof
                    if (
                        !isEqual(
                            generatedStateProof,
                            snapshotPayload.stateProof
                        )
                    ) {
                        return {
                            isValid: false,
                            error: "Generated state proof from encoded state does not match provided state proof"
                        };
                    }

                    console.log(
                        `Verified encoded state by generating matching state proof`
                    );
                }
            }

            // Return the participant's fork genesis snapshot as the proven state
            return {
                isValid: true,
                provenState: participantProvidedSnapshot
            };
        } catch (error) {
            console.error("Failed to verify payload:", error);
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
        try {
            // Store the proven state snapshot in local storage
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
