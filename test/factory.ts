import { ethers } from "hardhat";
import {
    BlockStruct,
    TransactionStruct,
    TransactionHeaderStruct,
    TransactionBodyStruct,
    JoinChannelStruct,
    SignedBlockStruct,
    BlockConfirmationStruct,
    ExitChannelBlockStruct,
    JoinChannelBlockStruct,
    StateSnapshotStruct,
    SnapshotDataStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import {
    DisputeStruct,
    SignedDisputeStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import { randomInt } from "crypto";
import { Codec, Type } from "@/utils";
import { Block, StateSnapshot } from "@/models";
import { BlockHeight, Bytes, ForkId, Timestamp } from "@/types/types";
import { DisputeInputStruct } from "@typechain-types/contracts/V1/StateChannelManagerEvents";
import { BytesLike } from "ethers";

export const hash = () => ethers.hexlify(ethers.randomBytes(32));

// Create a dummy wallet for generating valid signatures
const dummyWallet = new ethers.Wallet(
    "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
);

export const signature = () => {
    // Sign a fixed message to get a valid signature
    const message = "dummy message for testing";
    return dummyWallet.signMessageSync(message);
};

/**
 * Creates a default transaction header
 * @returns A transaction header with default values
 */
export function transactionHeader(
    overrides: Partial<TransactionHeaderStruct> = {}
): TransactionHeaderStruct {
    return {
        channelId: ethers.hexlify(ethers.zeroPadBytes("0x00", 32)),
        forkId: ethers.hexlify(ethers.zeroPadBytes("0x01", 32)),
        transactionCnt: 0,
        participant: ethers.Wallet.createRandom().address,
        timestamp: Math.floor(Date.now() / 1000),
        ...overrides
    };
}

/**
 * Creates a default transaction body
 * @returns A transaction body with default values
 */
export function transactionBody(
    overrides: Partial<TransactionBodyStruct> = {}
): TransactionBodyStruct {
    return {
        encodedData: "0x",
        data: "0x",
        ...overrides
    };
}

/**
 * Creates a default transaction
 * @returns A transaction with default values
 */
export function transaction(
    overrides: Partial<TransactionStruct> = {}
): TransactionStruct {
    const transaction: TransactionStruct = {
        header: transactionHeader(),
        body: transactionBody()
    };

    // Deep merge for nested properties
    if (overrides.header) {
        transaction.header = { ...transaction.header, ...overrides.header };
    }

    if (overrides.body) {
        transaction.body = { ...transaction.body, ...overrides.body };
    }

    // Apply other top-level overrides
    return { ...transaction, ...overrides };
}

/**
 * Creates a mock block for testing
 * @param overrides Optional overrides for the block properties
 * @returns A mock Block instance
 */
export function block(overrides: Partial<BlockStruct> = {}): Block {
    const blockStruct: BlockStruct = {
        transaction: transaction(),
        previousBlockHash: ethers.hexlify(ethers.randomBytes(32)),
        stateSnapshotHash: ethers.hexlify(ethers.randomBytes(32))
    };

    if (overrides.transaction) {
        blockStruct.transaction = transaction({
            ...blockStruct.transaction,
            ...overrides.transaction
        });
    }

    const finalBlockStruct = { ...blockStruct, ...overrides };

    // Create a SignedBlockStruct to use with Block.fromSignedBlock
    const signedBlockStruct: SignedBlockStruct = {
        encodedBlock: Codec.encode(finalBlockStruct, Type.Block),
        signature: signature()
    };

    return Block.fromSignedBlock(signedBlockStruct);
}

/**
 * Creates a mock DisputeStruct for testing
 * @param overrides Optional override values for the dispute fields
 * @returns A DisputeStruct with default values and any provided overrides
 */
export function dispute(
    overrides: Partial<{
        input: Partial<DisputeInputStruct>;
        outputSnapshotDataHash?: Bytes;
    }> = {}
): DisputeStruct {
    const defaultDispute: DisputeStruct = {
        input: {
            channelId: ethers.hexlify(ethers.zeroPadBytes("0x00", 32)),
            genesisSnapshotDataHash: ethers.hexlify(ethers.randomBytes(32)),
            latestStateSnapshotHash: ethers.hexlify(ethers.randomBytes(32)),
            stateProof: {
                milestones: [],
                signedBlocks: []
            },
            onChainSlashes: [],
            disputeAuditingDataHash: ethers.hexlify(ethers.randomBytes(32)),
            disputer: ethers.ZeroAddress,
            timeout: {
                participant: ethers.ZeroAddress,
                blockHeight: 0,
                minTimeStamp: Math.floor(Date.now() / 1000),
                isForced: false,
                previousBlockProducer: ethers.ZeroAddress,
                previousBlockProducerPostedCalldata: false,
                participantSignatureOnPreviousBlock: ethers.hexlify(
                    ethers.randomBytes(32)
                )
            },
            selfRemoval: false
        },

        outputSnapshotDataHash: ethers.hexlify(ethers.randomBytes(32))
    };
    const dispute = {
        input: {
            ...defaultDispute.input,
            ...overrides.input
        },
        outputSnapshotDataHash:
            overrides.outputSnapshotDataHash ||
            defaultDispute.outputSnapshotDataHash
    };

    return { ...dispute };
}

export function joinChannel(
    overrides: Partial<JoinChannelStruct> = {}
): JoinChannelStruct {
    const defaultJoinChannel: JoinChannelStruct = {
        channelId: ethers.hexlify(ethers.zeroPadBytes("0x00", 32)),
        participant: ethers.Wallet.createRandom().address,
        balance: {
            amount: BigInt(randomInt(1, 100)),
            data: ethers.hexlify(ethers.randomBytes(32))
        },
        deadlineTimestamp: BigInt(randomInt(1, 100))
    };

    return { ...defaultJoinChannel, ...overrides };
}
export function joinChannelBlock(
    overrides: Partial<JoinChannelBlockStruct> = {}
): JoinChannelBlockStruct {
    const defaultJoinChannelBlock: JoinChannelBlockStruct = {
        previousBlockHash: ethers.hexlify(ethers.randomBytes(32)),
        joinChannels: [joinChannel()]
    };

    return { ...defaultJoinChannelBlock, ...overrides };
}
export function signedBlock(
    overrides: Partial<SignedBlockStruct> = {}
): SignedBlockStruct {
    const mockBlock = block();
    const defaultSignedBlock: SignedBlockStruct = {
        encodedBlock: Codec.encode(mockBlock.blockStruct, Type.Block),
        signature: signature()
    };

    return { ...defaultSignedBlock, ...overrides };
}

export function signedDispute(
    overrides: Partial<SignedDisputeStruct> = {}
): SignedDisputeStruct {
    const defaultSignedDispute: SignedDisputeStruct = {
        encodedDispute: Codec.encode(dispute(), Type.Dispute),
        signature: signature()
    };

    return { ...defaultSignedDispute, ...overrides };
}

export function blockConfirmation(
    overrides: Partial<BlockConfirmationStruct> = {}
): BlockConfirmationStruct {
    const defaultBlockConfirmation: BlockConfirmationStruct = {
        signedBlock: signedBlock(),
        signatures: [signature(), signature()]
    };

    return { ...defaultBlockConfirmation, ...overrides };
}

export function exitChannelBlock(
    overrides: Partial<ExitChannelBlockStruct> = {}
): ExitChannelBlockStruct {
    const defaultExitChannelBlock: ExitChannelBlockStruct = {
        exitChannels: [],
        previousBlockHash: ethers.hexlify(ethers.randomBytes(32))
    };

    return { ...defaultExitChannelBlock, ...overrides };
}

export function stateSnapshot(
    overrides: Partial<{
        snapshotData: Partial<SnapshotDataStruct>;
        forkId?: ForkId;
        blockHeight?: BlockHeight;
        timestamp?: Timestamp;
    }> = {}
): StateSnapshot {
    const defaultStateSnapshot: StateSnapshotStruct = {
        snapshotData: {
            originForkId: ethers.hexlify(ethers.randomBytes(32)),
            stateMachineStateHash: ethers.hexlify(ethers.randomBytes(32)),
            participants: [
                ethers.Wallet.createRandom().address,
                ethers.Wallet.createRandom().address
            ],
            latestJoinChannelBlockHash: ethers.hexlify(ethers.randomBytes(32)),
            latestExitChannelBlockHash: ethers.hexlify(ethers.randomBytes(32)),
            totalDeposits: {
                amount: BigInt(randomInt(1, 1000)),
                data: "0x"
            },
            totalWithdrawals: {
                amount: BigInt(randomInt(1, 500)),
                data: "0x"
            }
        },
        forkId: ethers.hexlify(ethers.randomBytes(32)),
        blockHeight: BigInt(randomInt(0, 500)),
        timestamp: Math.floor(Date.now() / 1000)
    };
    const snapshotData = {
        ...defaultStateSnapshot.snapshotData,
        ...overrides.snapshotData
    };
    const stateSnapshot = {
        ...defaultStateSnapshot,
        snapshotData,
        ...overrides
    };

    return StateSnapshot.from(stateSnapshot as StateSnapshotStruct);
}
