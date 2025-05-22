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
                return; // Request expired
            }

            // Split into two handlers based on whether we have a confirmation signature
            if (!confirmationSignature) {
                // Handle new join request (no confirmation signature)
                await this.handleNewRequest(
                    key,
                    joinChannel,
                    signedJoinChannel,
                    timeRemaining
                );
            } else {
                // Handle confirmation signature
                await this.handleConfirmation(
                    key,
                    joinChannel,
                    signedJoinChannel,
                    confirmationSignature
                );
            }
        } catch (error) {
            console.error("Error processing join channel request:", error);
        }
    }

    /**
     * Validate the original request and requester's signature
     */
    private async validateOriginalRequest(
        joinChannel: JoinChannelStruct,
        signedJoinChannel: SignedJoinChannelStruct
    ): Promise<boolean> {
        // Validate the signature matches the participant
        const signerAddress = EvmUtils.retrieveSignerAddressJoinChannel(
            joinChannel,
            signedJoinChannel.signature as SignatureLike
        );

        if (joinChannel.participant !== signerAddress) {
            return false; // Invalid signature
        }

        // Ensure the participant is not already in the channel
        const activeParticipantsSet = await this.getActiveParticipants(
            joinChannel.channelId
        );
        if (activeParticipantsSet.has(joinChannel.participant.toString())) {
            return false; // Participant already in channel
        }

        return true;
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
        signedJoinChannel: SignedJoinChannelStruct,
        timeRemaining: number
    ): void {
        // Add requester's signature
        this.joinChannelMap.tryInsert(key, {
            signerAddress: joinChannel.participant.toString(),
            signature: signedJoinChannel.signature as SignatureLike
        });

        // Set expiration
        setTimeout(() => {
            this.joinChannelMap.delete(key);
        }, timeRemaining * 1000);
    }

    /**
     * Sign and broadcast our signature
     */
    private async signAndBroadcast(
        joinChannel: JoinChannelStruct,
        signedJoinChannel: SignedJoinChannelStruct,
        key: string
    ): Promise<void> {
        // Sign it ourselves
        const mySignedJC = await EvmUtils.signJoinChannel(
            joinChannel,
            this.mainRpcService.p2pManager.p2pSigner
        );

        // Add our signature
        const myAddress =
            await this.mainRpcService.p2pManager.p2pSigner.getAddress();
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

    /**
     * Handle a new join channel request (no confirmation signature)
     */
    private async handleNewRequest(
        key: string,
        joinChannel: JoinChannelStruct,
        signedJoinChannel: SignedJoinChannelStruct,
        timeRemaining: number
    ): Promise<void> {
        // Validate the request
        const isValid = await this.validateOriginalRequest(
            joinChannel,
            signedJoinChannel
        );
        if (!isValid) {
            return;
        }

        // Create entry if doesn't exist
        if (!this.joinChannelMap.has(key)) {
            // Initialize the request
            this.initializeRequest(
                key,
                joinChannel,
                signedJoinChannel,
                timeRemaining
            );

            // Sign and broadcast
            await this.signAndBroadcast(joinChannel, signedJoinChannel, key);
        }
    }

    /**
     * Handle a confirmation signature
     */
    private async handleConfirmation(
        key: string,
        joinChannel: JoinChannelStruct,
        signedJoinChannel: SignedJoinChannelStruct,
        confirmationSignature: SignatureLike
    ): Promise<void> {
        // First, check if we have this request already
        const isNewRequest = !this.joinChannelMap.has(key);

        if (isNewRequest) {
            // Validate the original request
            const isValid = await this.validateOriginalRequest(
                joinChannel,
                signedJoinChannel
            );
            if (!isValid) {
                return;
            }

            // Initialize the request
            const timeRemaining =
                Number(joinChannel.deadlineTimestamp) -
                Clock.getTimeInSeconds();
            this.initializeRequest(
                key,
                joinChannel,
                signedJoinChannel,
                timeRemaining
            );
        }

        // Verify the confirmation signature
        const confirmerAddress = EvmUtils.retrieveSignerAddressJoinChannel(
            joinChannel,
            confirmationSignature
        );

        // Make sure this isn't the creator signing again
        if (confirmerAddress === joinChannel.participant) {
            return; // Creator can't confirm their own request
        }

        // Check if signer is in the allowed participant set
        const activeParticipantsSet = await this.getActiveParticipants(
            joinChannel.channelId
        );
        if (!activeParticipantsSet.has(confirmerAddress)) {
            return; // Not an allowed participant
        }

        // Store the confirmation signature
        this.joinChannelMap.tryInsert(key, {
            signerAddress: confirmerAddress,
            signature: confirmationSignature
        });

        // Sign it ourselves if we haven't already
        const myAddress =
            await this.mainRpcService.p2pManager.p2pSigner.getAddress();
        if (
            !this.joinChannelMap
                .get(key)
                .some((sig) => sig.signerAddress === myAddress)
        ) {
            await this.signAndBroadcast(joinChannel, signedJoinChannel, key);
        }

        // Check if we have all required signatures
        const activeParticipants = Array.from(activeParticipantsSet);
        if (this.joinChannelMap.didEveryoneSign(key, activeParticipants)) {
            await this.processCompletedJoinRequest(
                signedJoinChannel,
                this.joinChannelMap.getSignatures(key)
            );
        }
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
