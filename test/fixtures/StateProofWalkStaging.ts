// @spec-test-coverage-ignore: shared state-proof walk staging; the executable evidence is mapped from UniversalDeployment.test.ts
import { StateSnapshot } from "@/models";
import { Codec, SignatureUtils, Type } from "@/utils";
import * as factory from "@test/factory";
import {
    ProofWalkInputStruct,
    ProofWalkResultStructOutput
} from "@typechain-types/contracts/V1/StateChannelDiamondProxy/StateProofFacet";
import {
    BlockConfirmationStruct,
    StateSnapshotStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { MilestoneProofStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { ethers, Signer } from "ethers";

/** A channel and its genesis snapshot. */
export type WalkChannel = {
    channelId: string;
    genesis: StateSnapshotStruct;
};

/** The genesis successor at `height`: the genesis data with a state that names the height. */
export function snapshotAt(
    genesis: StateSnapshotStruct,
    height: bigint
): StateSnapshotStruct {
    return {
        snapshotData: {
            ...genesis.snapshotData,
            stateMachineStateHash: ethers.id(`walk state ${height}`)
        },
        forkId: genesis.forkId,
        blockHeight: height,
        timestamp: BigInt(genesis.timestamp) + height + 1n
    };
}

/**
 * One linked run of `channel` at `heights` that only `author` signed, each
 * block committing `snapshotAt(height)`; the first block links to no block.
 */
export async function authorOnlyRun(
    channel: WalkChannel,
    author: Signer,
    heights: bigint[]
): Promise<MilestoneProofStruct> {
    const blockConfirmations: BlockConfirmationStruct[] = [];
    let previousBlockHash = ethers.ZeroHash;
    for (const height of heights) {
        const encodedBlock = Codec.encode(
            {
                transaction: {
                    header: {
                        channelId: channel.channelId,
                        participant: await author.getAddress(),
                        forkId: channel.genesis.forkId,
                        transactionCnt: height,
                        timestamp: BigInt(channel.genesis.timestamp) + 1n
                    },
                    body: { encodedData: "0x", data: "0x" }
                },
                stateSnapshotHash: StateSnapshot.from(
                    snapshotAt(channel.genesis, height)
                ).hash,
                previousBlockHash,
                messageBlocks: []
            },
            Type.Block
        );
        const signature = ethers.Signature.from(
            await SignatureUtils.signMsg(encodedBlock, author)
        ).serialized;
        blockConfirmations.push({
            signedBlock: { encodedBlock, signature },
            signatures: []
        });
        previousBlockHash = ethers.keccak256(encodedBlock);
    }
    return { blockConfirmations };
}

/** The walk input for `channel` with `milestones` and their `milestoneSnapshots`. */
export function walkInput(
    channel: WalkChannel,
    milestones: MilestoneProofStruct[],
    milestoneSnapshots: StateSnapshotStruct[]
): ProofWalkInputStruct {
    return {
        channelId: channel.channelId,
        forkId: channel.genesis.forkId,
        stateProof: { milestones },
        genesisStateSnapshotData: channel.genesis.snapshotData,
        milestoneSnapshots
    };
}

/** A channel whose genesis is built off chain with `participants`, for a local mirror the test seeds itself. */
export function walkChannelGenesis(
    channelName: string,
    participants: string[],
    timestamp: bigint
): WalkChannel {
    const snapshotData = factory.snapshotData({ participants });
    return {
        channelId: ethers.id(channelName),
        genesis: {
            snapshotData,
            forkId: ethers.keccak256(
                Codec.encode(snapshotData, Type.SnapshotData)
            ),
            blockHeight: 0n,
            timestamp
        }
    };
}

/** The walk result as plain values. */
export function walkResultProjection(result: ProofWalkResultStructOutput) {
    return {
        valid: result.valid,
        finalizedSnapshotHash: StateSnapshot.from(result.finalizedSnapshot)
            .hash,
        replayBlockIndex: result.replayBlockIndex
    };
}
