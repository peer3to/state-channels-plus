import { ARpcService, MainRpcService } from "@/rpc";
import {
    SignedJoinChannelStruct,
    JoinChannelStruct,
    ExitChannelBlockStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { MilestoneProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";
import { Codec, SignatureCollectionMap, SignatureUtils, Type } from "@/utils";
import Clock from "@/Clock";
import { getActiveParticipants } from "@/utils/participantUtils";
import { StateSnapshot } from "@/models";
import { Address, Bytes, ChannelId, Hash, Signature } from "@/types/types";
import JoinChannelRpcMethods from "./JoinChannelRpcMethods";
import { ATransport } from "@/transport";
import P2PManager from "@/P2PManager";

export enum ValidationFlag {
    VALID,
    INVALID_SIGNATURE,
    DOUBLE_SIGN,
    DISCONNECT
}

class JoinChannelService extends ARpcService<JoinChannelRpcMethods> {
    // **** part of joinChannel logic ****
    joinChannelMap = new SignatureCollectionMap();

    constructor(p2pManager: P2PManager) {
        super(
            p2pManager,
            p2pManager.stateManager.logger.child({
                component: "JoinChannelService"
            })
        );
    }

    public createRPCMethods(transport: ATransport): JoinChannelRpcMethods {
        return new JoinChannelRpcMethods(transport, this);
    }

    public async validateConfirmationSignature(
        joinChannel: JoinChannelStruct,
        confirmationSignature: Signature
    ): Promise<ValidationFlag> {
        let confirmerAddress: Address;
        try {
            // Verify the signature itself is well-formed
            confirmerAddress = SignatureUtils.getSignerAddressJoinChannel(
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

    public async validateOriginalRequest(
        joinChannel: JoinChannelStruct,
        signature: Signature | Bytes
    ): Promise<ValidationFlag> {
        // Validate the signature matches the participant
        let signerAddress: Address;
        try {
            signerAddress = SignatureUtils.getSignerAddressJoinChannel(
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

    public async getActiveParticipants(
        channelId: ChannelId
    ): Promise<Set<Address>> {
        const scmContract =
            this.p2pManager.stateManager.stateChannelManagerContract;
        return await getActiveParticipants(scmContract, channelId);
    }

    public async needsStateSnapshotSubmission(
        channelId: ChannelId
    ): Promise<boolean> {
        // TODO
        // right now we are cutting slack and just assume that we need to submit a state snapshot
        // since that is by far the most common case

        // when we will have a solid storage layer, what needs to be done here is one of two options:
        // a. the ok option: look at locally stored latest state snapshot and compare to the one on chain
        // b. the better option: there is a "onStateSnapshotUpdated" hook (or similar name). this should be used to locally store the latest stateSnapshot
        // that is on chain - this way the comparison will not need to call the chain
        return true;
    }

    /**
     * Prepare state snapshot data for on-chain submission
     * TODO: Implement the actual logic to generate milestone proofs, snapshots, and exit channel blocks
     * also, this function does not belong here, probably belongs to the state manager or maybe the agreement manager
     */
    public async prepareStateSnapshotData(): Promise<{
        milestoneProofs: MilestoneProofStruct[];
        milestoneSnapshots: StateSnapshot[];
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

    public async getPreviousJoinChannelBlockHash(
        channelId: ChannelId,
        needsStateSnapshotSubmission: boolean,
        milestoneSnapshots: StateSnapshot[]
    ): Promise<Hash> {
        if (needsStateSnapshotSubmission) {
            // We have milestone snapshots, use the latest one
            const latestSnapshot =
                milestoneSnapshots[milestoneSnapshots.length - 1];
            return latestSnapshot.latestJoinBlockHash;
        } else {
            // Read from chain
            const scmContract =
                this.p2pManager.stateManager.stateChannelManagerContract;
            const stateSnapshot = StateSnapshot.from(
                await scmContract.getStateSnapshot(channelId)
            );

            return stateSnapshot.latestJoinBlockHash;
        }
    }

    public async processCompletedJoinRequest(
        signedJoinChannel: SignedJoinChannelStruct
    ): Promise<void> {
        const joinChannel = Codec.decode(
            signedJoinChannel.encodedJoinChannel,
            Type.JoinChannel
        );

        // 1. Check if we need to submit a state snapshot
        const needsStateSnapshotSubmission =
            await this.needsStateSnapshotSubmission(joinChannel.channelId);

        let milestoneSnapshots: StateSnapshot[] = [];

        // 2. If state snapshot submission is needed, prepare and submit
        if (needsStateSnapshotSubmission) {
            const {
                milestoneProofs,
                milestoneSnapshots: snapshots,
                exitChannelBlocks
            } = await this.prepareStateSnapshotData();

            milestoneSnapshots = snapshots;

            await this.p2pManager.stateManager.postStateSnapshot(
                this.p2pManager.stateManager.forkId
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
