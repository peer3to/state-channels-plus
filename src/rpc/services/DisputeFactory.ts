import { ethers } from "ethers";
import { DisputeStruct } from "@typechain-types/contracts/V1/DisputeTypes";
import { JoinChannelStruct } from "@typechain-types/contracts/V1/DataTypes";
import { Codec, Type } from "@/utils";
import { Storage } from "@/storage";
import { AStateChannelManagerProxy } from "@typechain-types/index";

export class DisputeFactory {
    private readonly scmContract: AStateChannelManagerProxy;
    private readonly storage: Storage;

    constructor(scmContract: AStateChannelManagerProxy) {
        this.scmContract = scmContract;
        this.storage = Storage.getInstance();
    }

    /**
     * Creates a DisputeStruct for a join channel operation
     * @param joinChannel The join channel data
     * @returns A complete DisputeStruct for the join channel operation
     */
    public async createJoinChannelDispute(
        joinChannel: JoinChannelStruct
    ): Promise<DisputeStruct> {
        const latestOnChainStateSnapshot =
            this.storage.getLatestOnChainStateSnapshot();
        const latestStateSnapshot =
            this.storage.getLatestBlock().block.stateSnapshot;

        // Get on-chain data
        const onChainSlashedParticipants =
            await this.scmContract.getOnChainSlashedParticipants(
                joinChannel.channelId
            );
        const onChainLatestJoinChannelBlockHash =
            await this.scmContract.getOnChainLatestJoinChannelBlockHash(
                joinChannel.channelId
            );

        const disputeIndex = await this.scmContract.getDisputeLength(
            joinChannel.channelId
        );

        // Create and return the complete dispute structure
        const dispute: DisputeStruct = {
            channelId: joinChannel.channelId,

            genesisStateSnapshotHash: ethers.keccak256(
                Codec.encode(
                    latestOnChainStateSnapshot.stateSnapshot,
                    Type.StateSnapshot
                )
            ),

            latestStateSnapshotHash: ethers.keccak256(
                Codec.encode(latestStateSnapshot, Type.StateSnapshot)
            ),

            // TODO: NEEDS IMPLEMENTATION - Should provide finality proof of the latest state

            stateProof: {
                forkProof: {
                    forkMilestoneProofs: [] // on chain snapshot is already on the lastest fork
                },
                signedBlocks: [] // TODO: Add any additional blocks needed to reach latestStateSnapshot
            },

            fraudProofs: [],

            onChainSlashes: onChainSlashedParticipants,

            onChainLatestJoinChannelBlockHash:
                onChainLatestJoinChannelBlockHash || ethers.ZeroHash,

            // TODO:
            // This commits to the genesis state of the new fork with expanded participants
            // Should include: new participants, updated balances, incremented forkCnt
            outputStateSnapshotHash: ethers.keccak256(
                Codec.encode(latestStateSnapshot, Type.StateSnapshot) // TODO: Should be NEW snapshot with joined participants
            ),

            exitChannelBlocks: [],

            // TODO: NEEDS CALCULATION - Hash of all data needed for on-chain auditing
            // Should include: genesisStateSnapshot, latestStateSnapshot, milestoneSnapshots,
            // joinChannelBlocks, and any other data needed for dispute verification
            disputeAuditingDataHash: ethers.ZeroHash, // TODO: Calculate actual auditing data hash

            disputer: joinChannel.participant,

            disputeIndex: disputeIndex,

            previousRecursiveDisputeIndex: ethers.MaxUint256,

            timeout: {
                participant: ethers.ZeroAddress,
                blockHeight: 0,
                minTimeStamp: 0,
                forkCnt: 0,
                isForced: false,
                previousBlockProducer: ethers.ZeroAddress,
                previousBlockProducerPostedCalldata: false
            },

            selfRemoval: false
        };

        return dispute;
    }
}
