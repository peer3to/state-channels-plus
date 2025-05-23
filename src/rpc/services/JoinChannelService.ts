import { SignatureLike } from "ethers";
import { ARpcService, MainRpcService } from "@/rpc";
import {
    SignedJoinChannelStruct,
    JoinChannelStruct,
    ForkMilestoneProofStruct,
    StateSnapshotStruct,
    ExitChannelBlockStruct
} from "@typechain-types/contracts/V1/DataTypes";
import { EvmUtils, SignatureCollectionMap } from "@/utils";
import Clock from "@/Clock";
import { getActiveParticipants } from "@/utils/participantUtils";
import { BytesLike } from "ethers";

type JoinChanenelConfirmation = {
    signedJoinChannel: SignedJoinChannelStruct;
    confirmationSignatures: SignatureLike[];
};

enum ValidationFlag {
    VALID,
    INVALID_SIGNATURE,
    DOUBLE_SIGN,
    DISCONNECT,
    ALREADY_IN_CHANNEL
}

class JoinChannelService extends ARpcService {
    // **** part of joinChannel logic ****
    joinChannelMap = new SignatureCollectionMap();
    joinChannelQueue: JoinChanenelConfirmation[] = [];

    constructor(mainRpcService: MainRpcService) {
        super(mainRpcService);
    }
    public async onJoinChannelRequest(
        signedJoinChannel: SignedJoinChannelStruct,
        confirmationSignature?: SignatureLike
    ) {
        try {
            const key = signedJoinChannel.encodedJoinChannel.toString();
            const joinChannel = EvmUtils.decodeJoinChannel(
                signedJoinChannel.encodedJoinChannel
            );

            // Validate request timeframe
            const timeRemaining =
                Number(joinChannel.deadlineTimestamp) -
                Clock.getTimeInSeconds();
            if (timeRemaining <= 0) {
                this.joinChannelMap.delete(key);
                return; // Request expired
            }
            const isNewRequest = !this.joinChannelMap.has(key);

            // Handle new request initialization if needed
            if (isNewRequest) {
                // Validate the request
                const validationResult = await this.validateOriginalRequest(
                    joinChannel,
                    signedJoinChannel.signature as SignatureLike
                );
                if (validationResult !== ValidationFlag.VALID) {
                    console.warn(
                        `Invalid original request: ${ValidationFlag[validationResult]}`
                    );
                    return;
                }

                // Initialize the request with original signature
                this.initializeRequest(
                    key,
                    joinChannel,
                    signedJoinChannel.signature as SignatureLike,
                    timeRemaining
                );
            }

            // Process confirmation signature if present
            if (confirmationSignature) {
                // Validate the confirmation signature
                const validationResult =
                    await this.validateConfirmationSignature(
                        joinChannel,
                        confirmationSignature
                    );

                if (validationResult !== ValidationFlag.VALID) {
                    console.warn(
                        `Invalid confirmation signature: ${ValidationFlag[validationResult]}`
                    );
                    return;
                }

                const confirmerAddress =
                    EvmUtils.retrieveSignerAddressJoinChannel(
                        joinChannel,
                        confirmationSignature
                    );

                // Store the confirmation signature
                this.joinChannelMap.tryInsert(key, {
                    signerAddress: confirmerAddress,
                    signature: confirmationSignature
                });

                // Broadcast the incoming signature too
                this.mainRpcService.rpcProxy
                    .onJoinChannelRequest(
                        signedJoinChannel,
                        confirmationSignature
                    )
                    .broadcast();
            }

            // Add our signature if we haven't already
            const myAddress =
                await this.mainRpcService.p2pManager.p2pSigner.getAddress();
            if (
                !this.joinChannelMap
                    .get(key)
                    ?.some((sig) => sig.signerAddress === myAddress)
            ) {
                // Sign it ourselves
                const mySignedJC = await EvmUtils.signJoinChannel(
                    joinChannel,
                    this.mainRpcService.p2pManager.p2pSigner
                );

                // Add our signature
                this.joinChannelMap.tryInsert(key, {
                    signerAddress: myAddress,
                    signature: mySignedJC.signature as SignatureLike
                });

                // Broadcast with our signature
                this.mainRpcService.rpcProxy
                    .onJoinChannelRequest(
                        signedJoinChannel,
                        mySignedJC.signature as SignatureLike
                    )
                    .broadcast();
            }

            // Check if we have all required signatures
            const activeParticipantsSet = await this.getActiveParticipants(
                joinChannel.channelId
            );
            const activeParticipants = Array.from(activeParticipantsSet);
            if (this.joinChannelMap.didEveryoneSign(key, activeParticipants)) {
                await this.processCompletedJoinRequest(
                    signedJoinChannel,
                    this.joinChannelMap.getSignatures(key)
                );
            }
        } catch (error) {
            console.error("Error processing join channel request:", error);
        }
    }

    /**
     * Validate a confirmation signature and return validation flag
     */
    private async validateConfirmationSignature(
        joinChannel: JoinChannelStruct,
        confirmationSignature: SignatureLike
    ): Promise<ValidationFlag> {
        let confirmerAddress: string;
        try {
            // Verify the signature itself is well-formed
            confirmerAddress = EvmUtils.retrieveSignerAddressJoinChannel(
                joinChannel,
                confirmationSignature
            );
        } catch (error) {
            console.error("Error validating confirmation signature:", error);
            return ValidationFlag.INVALID_SIGNATURE;
        }

        // Make sure this isn't the creator signing again
        if (confirmerAddress === joinChannel.participant) {
            return ValidationFlag.DOUBLE_SIGN;
        }

        // Check if signer is in the allowed participant set
        const activeParticipantsSet = await this.getActiveParticipants(
            joinChannel.channelId
        );
        if (!activeParticipantsSet.has(confirmerAddress)) {
            return ValidationFlag.DISCONNECT;
        }

        return ValidationFlag.VALID;
    }

    /**
     * Validate the original request and requester's signature
     */
    private async validateOriginalRequest(
        joinChannel: JoinChannelStruct,
        signature: SignatureLike
    ): Promise<ValidationFlag> {
        // Validate the signature matches the participant
        let signerAddress: string;
        try {
            signerAddress = EvmUtils.retrieveSignerAddressJoinChannel(
                joinChannel,
                signature
            );
        } catch (error) {
            console.error("Error validating original request:", error);
            return ValidationFlag.INVALID_SIGNATURE;
        }

        if (joinChannel.participant !== signerAddress) {
            return ValidationFlag.INVALID_SIGNATURE;
        }

        // Ensure the participant is not already in the channel
        const activeParticipantsSet = await this.getActiveParticipants(
            joinChannel.channelId
        );
        if (activeParticipantsSet.has(joinChannel.participant.toString())) {
            return ValidationFlag.ALREADY_IN_CHANNEL;
        }

        return ValidationFlag.VALID;
    }

    /**
     * Get active participants for a channel
     */
    private async getActiveParticipants(
        channelId: BytesLike
    ): Promise<Set<string>> {
        const scmContract =
            this.mainRpcService.p2pManager.stateManager
                .stateChannelManagerContract;
        return await getActiveParticipants(scmContract, channelId);
    }

    /**
     * Initialize request in the map
     */
    private initializeRequest(
        key: string,
        joinChannel: JoinChannelStruct,
        signature: SignatureLike,
        timeRemaining: number
    ): void {
        // Add requester's signature
        this.joinChannelMap.tryInsert(key, {
            signerAddress: joinChannel.participant.toString(),
            signature: signature
        });

        // Set expiration
        setTimeout(() => {
            this.joinChannelMap.delete(key);
        }, timeRemaining * 1000);
    }

    private async needsStateSnapshotSubmission(
        channelId: BytesLike
    ): Promise<boolean> {
        const scmContract =
            this.mainRpcService.p2pManager.stateManager
                .stateChannelManagerContract;

        const [snapshotForkCnt, disputeLength] = await Promise.all([
            scmContract.getSnapshotForkCnt(channelId),
            scmContract.getDisputeLength(channelId)
        ]);

        return snapshotForkCnt !== disputeLength;
    }

    /**
     * Prepare state snapshot data for on-chain submission
     * TODO: Implement the actual logic to generate milestone proofs, snapshots, and exit channel blocks
     */
    private async prepareStateSnapshotData(): Promise<{
        milestoneProofs: ForkMilestoneProofStruct[];
        milestoneSnapshots: StateSnapshotStruct[];
        exitChannelBlocks: ExitChannelBlockStruct[];
    }> {
        // TODO: Implement actual logic
        // This should:
        // 1. Generate milestone proofs for the fork transitions
        // 2. Create state snapshots that include the new participant
        // 3. Generate exit channel blocks if needed

        // Placeholder return - replace with actual implementation
        return {
            milestoneProofs: [],
            milestoneSnapshots: [],
            exitChannelBlocks: []
        };
    }

    /**
     * Get the previous join channel block hash
     */
    private async getPreviousJoinChannelBlockHash(
        channelId: BytesLike,
        needsStateSnapshotSubmission: boolean,
        milestoneSnapshots: StateSnapshotStruct[]
    ): Promise<string> {
        if (needsStateSnapshotSubmission) {
            // We have milestone snapshots, use the latest one
            const latestSnapshot =
                milestoneSnapshots[milestoneSnapshots.length - 1];
            return latestSnapshot.latestJoinChannelBlockHash as string;
        } else {
            // Read from chain
            const scmContract =
                this.mainRpcService.p2pManager.stateManager
                    .stateChannelManagerContract;
            const stateSnapshot = await scmContract.getStateSnapshot(channelId);
            return stateSnapshot.latestJoinChannelBlockHash as string;
        }
    }

    /**
     * Process a completed join channel request with all required signatures
     */
    private async processCompletedJoinRequest(
        signedJoinChannel: SignedJoinChannelStruct,
        confirmationSignatures: SignatureLike[]
    ): Promise<void> {
        const joinChannel = EvmUtils.decodeJoinChannel(
            signedJoinChannel.encodedJoinChannel
        );

        // 1. Check if we need to submit a state snapshot
        const needsStateSnapshotSubmission =
            await this.needsStateSnapshotSubmission(joinChannel.channelId);

        let milestoneSnapshots: StateSnapshotStruct[] = [];

        // 2. If state snapshot submission is needed, prepare and submit
        if (needsStateSnapshotSubmission) {
            const {
                milestoneProofs,
                milestoneSnapshots: snapshots,
                exitChannelBlocks
            } = await this.prepareStateSnapshotData();

            milestoneSnapshots = snapshots;

            await this.mainRpcService.p2pManager.stateManager.postStateSnapshot(
                milestoneProofs,
                milestoneSnapshots,
                exitChannelBlocks
            );
        }

        // 3. Create JoinChannelBlock with the completed join channel request
        const previousBlockHash = await this.getPreviousJoinChannelBlockHash(
            joinChannel.channelId,
            needsStateSnapshotSubmission,
            milestoneSnapshots
        );

        const joinChannelBlock = {
            joinChannels: [joinChannel],
            previousBlockHash
        };

        // 4. Create the Dispute that will increase the number of participants to include the new participant
        // currently (23.05.2025) is "under construction". waiting for the TS side machinary to collect the dispute data
        // to be written by Mrisho

        // 5. submit to chain
    }
}

export default JoinChannelService;
