import { SignatureLike } from "ethers";
import { ARpcService, MainRpcService } from "@/rpc";
import {
    SignedJoinChannelStruct,
    JoinChannelStruct
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

    /**
     * Process a completed join channel request with all required signatures
     */
    private async processCompletedJoinRequest(
        signedJoinChannel: SignedJoinChannelStruct,
        confirmationSignatures: SignatureLike[]
    ): Promise<void> {
        // TODO: Replace this with actual implementation
        // Should read on-chain data and update as needed

        const joinChannel = EvmUtils.decodeJoinChannel(
            signedJoinChannel.encodedJoinChannel
        );

        // 1. Read on-chain data
        // const channelInfo = await this.mainRpcService.p2pManager.stateManager.getChannelInfo(joinChannel.channelId);

        // 2. Update state manager
        // await this.mainRpcService.p2pManager.stateManager.agreementManager.addJoinChannel(
        //     joinChannel,
        //     signedJoinChannel.signature,
        //     confirmationSignatures
        // );

        // 3. If leader, update on-chain state
        // if (this.mainRpcService.p2pManager.p2pSigner.getIsLeader()) {
        //     await this.updateChannelOnChain(joinChannel, confirmationSignatures);
        // }

        console.log("Join channel request processed with all signatures", {
            channelId: joinChannel.channelId,
            participant: joinChannel.participant,
            signatures: confirmationSignatures.length
        });
    }
}

export default JoinChannelService;
