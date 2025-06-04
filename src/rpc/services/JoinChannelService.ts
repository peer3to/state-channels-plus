import { SignatureLike } from "ethers";
import { ARpcService, MainRpcService } from "@/rpc";
import {
    SignedJoinChannelStruct,
    JoinChannelStruct,
    ForkMilestoneProofStruct,
    StateSnapshotStruct,
    ExitChannelBlockStruct
} from "@typechain-types/contracts/V1/DataTypes";
import { Codec, EvmUtils, SignatureCollectionMap, Type } from "@/utils";
import Clock from "@/Clock";
import { getActiveParticipants } from "@/utils/participantUtils";
import { BytesLike } from "ethers";
import { Storage } from "@/storage";
import { AStateChannelManagerProxy } from "@typechain-types/index";
import { DisputeFactory } from "./DisputeFactory";

enum ValidationFlag {
    VALID,
    INVALID_SIGNATURE,
    DOUBLE_SIGN,
    DISCONNECT
}

class JoinChannelService extends ARpcService {
    // **** part of joinChannel logic ****
    joinChannelMap = new SignatureCollectionMap();

    private readonly scmContract: AStateChannelManagerProxy;
    private readonly disputeFactory: DisputeFactory;
    private readonly storage: Storage;

    constructor(mainRpcService: MainRpcService) {
        super(mainRpcService);
        this.scmContract =
            mainRpcService.p2pManager.stateManager.stateChannelManagerContract;
        this.disputeFactory = new DisputeFactory(this.scmContract);
        this.storage = Storage.getInstance();
    }
    public async onJoinChannelRequest(
        signedJoinChannel: SignedJoinChannelStruct,
        confirmationSignature?: SignatureLike
    ) {
        try {
            const key = signedJoinChannel.encodedJoinChannel.toString();
            const joinChannel = Codec.decode(
                signedJoinChannel.encodedJoinChannel,
                Type.JoinChannel
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

                // Add requester's signature with timeout
                this.joinChannelMap.tryInsert(
                    key,
                    {
                        signerAddress: joinChannel.participant.toString(),
                        signature: signedJoinChannel.signature as SignatureLike
                    },
                    { timeoutMs: timeRemaining * 1000 } // Convert to milliseconds
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
            if (!this.joinChannelMap.hasSignature(key, myAddress)) {
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
                await this.processCompletedJoinRequest(signedJoinChannel);
            }
        } catch (error) {
            console.error("Error processing join channel request:", error);
        }
    }

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

        return ValidationFlag.VALID;
    }

    private async getActiveParticipants(
        channelId: BytesLike
    ): Promise<Set<string>> {
        return await getActiveParticipants(this.scmContract, channelId);
    }

    private async needsStateSnapshotSubmission(
        _channelId: BytesLike
    ): Promise<boolean> {
        const lastestBlock = this.storage.getLatestBlock();
        if (!lastestBlock) {
            return true;
        }
        const lastestStateSnapshot = lastestBlock.block.stateSnapshot;
        const latestOnChainStateSnapshot =
            this.storage.getLatestOnChainStateSnapshot();
        if (!latestOnChainStateSnapshot) {
            return true;
        }
        return (
            Codec.encode(lastestStateSnapshot, Type.StateSnapshot) !==
            Codec.encode(
                latestOnChainStateSnapshot.stateSnapshot,
                Type.StateSnapshot
            )
        );
    }

    /**
     * Prepare state snapshot data for on-chain submission
     * TODO: Implement the actual logic to generate milestone proofs, snapshots, and exit channel blocks
     * also, this function does not belong here, probably belongs to the state manager or maybe the agreement manager
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
            const { stateSnapshot } =
                this.storage.getLatestOnChainStateSnapshot();
            return stateSnapshot.latestJoinChannelBlockHash as string;
        }
    }

    private async processCompletedJoinRequest(
        signedJoinChannel: SignedJoinChannelStruct
    ): Promise<void> {
        const joinChannel = Codec.decode(
            signedJoinChannel.encodedJoinChannel,
            Type.JoinChannel
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

        const dispute =
            await this.disputeFactory.createJoinChannelDispute(joinChannel);

        // 5. gossip the dispute and collect signatures of the joiners

        // 6. submit to chain
        const stateManager = this.mainRpcService.p2pManager.stateManager;
        // await stateManager.postJoinChannel(
        //     milestoneProofs,
        //     milestoneSnapshots,
        //     joinChannelBlock,
        // );
    }
}

export default JoinChannelService;
