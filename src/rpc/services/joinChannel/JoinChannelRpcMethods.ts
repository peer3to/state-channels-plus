import ARpcMethods from "@/rpc/ARpcMethods";
import { ATransport } from "@/transport";
import JoinChannelService, { ValidationFlag } from "./JoinChannelService";
import { SignedJoinChannelStruct } from "@typechain-types/contracts/V1/StateChannelManagerInterface";
import { Signature } from "@/types/types";
import { Codec, SignatureUtils, Type } from "@/utils";
import Clock from "@/Clock";

class JoinChannelRpcMethods extends ARpcMethods {
    service: JoinChannelService;
    constructor(transport: ATransport, service: JoinChannelService) {
        super(transport, service.p2pManager);
        this.service = service;
    }

    public async onJoinChannelRequest(
        signedJoinChannel: SignedJoinChannelStruct,
        confirmationSignature?: Signature
    ) {
        try {
            const key = signedJoinChannel.encodedJoinChannel;
            const joinChannel = Codec.decode(
                signedJoinChannel.encodedJoinChannel,
                Type.JoinChannel
            );

            // Validate request timeframe
            const timeRemaining =
                Number(joinChannel.deadlineTimestamp) -
                Clock.getTimeInSeconds();
            if (timeRemaining <= 0) {
                this.service.joinChannelMap.delete(key);
                return; // Request expired
            }
            const isNewRequest = !this.service.joinChannelMap.has(key);

            // Handle new request initialization if needed
            if (isNewRequest) {
                // Validate the request
                const validationResult =
                    await this.service.validateOriginalRequest(
                        joinChannel,
                        signedJoinChannel.signature
                    );
                if (validationResult !== ValidationFlag.VALID) {
                    console.warn(
                        `Invalid original request: ${ValidationFlag[validationResult]}`
                    );
                    return;
                }

                // Add requester's signature with timeout
                this.service.joinChannelMap.tryInsert(
                    key,
                    {
                        signerAddress: joinChannel.participant.toString(),
                        signature: signedJoinChannel.signature
                    },
                    { timeoutMs: timeRemaining * 1000 } // Convert to milliseconds
                );
            }

            // Process confirmation signature if present
            if (confirmationSignature) {
                // Validate the confirmation signature
                const validationResult =
                    await this.service.validateConfirmationSignature(
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
                    SignatureUtils.getSignerAddressJoinChannel(
                        joinChannel,
                        confirmationSignature
                    );

                // Store the confirmation signature
                this.service.joinChannelMap.tryInsert(key, {
                    signerAddress: confirmerAddress,
                    signature: confirmationSignature
                });

                // Broadcast the incoming signature too
                this.remoteRpc.joinChannelService
                    .onJoinChannelRequest(
                        signedJoinChannel,
                        confirmationSignature
                    )
                    .broadcast();
            }

            // Add our signature if we haven't already
            const myAddress = await this.p2pManager.p2pSigner.getAddress();
            if (!this.service.joinChannelMap.hasSignature(key, myAddress)) {
                // Sign it ourselves
                const mySignedJC = await SignatureUtils.signJoinChannel(
                    joinChannel,
                    this.p2pManager.p2pSigner
                );

                // Add our signature
                this.service.joinChannelMap.tryInsert(key, {
                    signerAddress: myAddress,
                    signature: mySignedJC.signature
                });

                // Broadcast with our signature
                this.remoteRpc.joinChannelService
                    .onJoinChannelRequest(
                        signedJoinChannel,
                        mySignedJC.signature as Signature
                    )
                    .broadcast();
            }

            // Check if we have all required signatures
            const activeParticipantsSet =
                await this.service.getActiveParticipants(joinChannel.channelId);
            const activeParticipants = Array.from(activeParticipantsSet);
            if (
                this.service.joinChannelMap.didEveryoneSign(
                    key,
                    activeParticipants
                )
            ) {
                await this.service.processCompletedJoinRequest(
                    signedJoinChannel
                );
            }
        } catch (error) {
            console.error("Error processing join channel request:", error);
        }
    }
}

export default JoinChannelRpcMethods;
