// Plain ethers, not hardhat's: the SDK worker thread imports helpers from this
// file (via HarnessControlRpc → DisputeService), and requiring "hardhat" there
// boots the whole Hardhat runtime — incl. hardhat-foundry's sync `forge config`
// exec — blocking the worker's event loop for ~800ms.
import { ethers } from "ethers";
import {
    BlockStruct,
    TransactionStruct,
    TransactionHeaderStruct,
    TransactionBodyStruct,
    JoinChannelStruct,
    SignedBlockStruct,
    BlockConfirmationStruct,
    StateSnapshotStruct,
    SnapshotDataStruct,
    MessageBlockStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import {
    DisputeStruct,
    SignedDisputeStruct,
    DisputeInputStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import { StateProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";
import { randomInt } from "crypto";
import { Codec, Type } from "@/utils";
import { Block, StateSnapshot } from "@/models";
import {
    Address,
    BlockHeight,
    Bytes,
    ForkId,
    Hash,
    Timestamp
} from "@/types/types";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

export const hash = (): `0x${string}` =>
    ethers.hexlify(ethers.randomBytes(32)) as `0x${string}`;

export const randomAddress = (): Address =>
    ethers.Wallet.createRandom().address as Address;

export const hexString = (length: number = 32): Bytes => {
    return ethers.hexlify(ethers.randomBytes(length));
};

export const zeroHex = (length: number = 32): Bytes => {
    return ethers.hexlify(ethers.zeroPadBytes("0x00", length));
};

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
    overrides: Partial<TransactionHeaderStruct> = {},
    signer?: HardhatEthersSigner
): TransactionHeaderStruct {
    return {
        channelId: ethers.hexlify(ethers.zeroPadBytes("0x00", 32)),
        forkId: ethers.hexlify(ethers.zeroPadBytes("0x01", 32)),
        transactionCnt: 0,
        participant: signer?.address || ethers.Wallet.createRandom().address,
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
    overrides: Partial<TransactionStruct> = {},
    signer?: HardhatEthersSigner
): TransactionStruct {
    const transaction: TransactionStruct = {
        header: transactionHeader(undefined, signer),
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
export function block(
    overrides: Partial<BlockStruct> = {},
    signer?: HardhatEthersSigner
): Block {
    const blockStruct: BlockStruct = {
        transaction: transaction(undefined, signer),
        previousBlockHash: ethers.hexlify(ethers.randomBytes(32)),
        stateSnapshotHash: ethers.hexlify(ethers.randomBytes(32)),
        messageBlocks: []
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

/** Copy of `blockStruct` with `transaction.header` shallow-merged with `header`. */
export function blockStructWithTransactionHeader(
    bs: BlockStruct,
    header: Partial<TransactionHeaderStruct>
): BlockStruct {
    return {
        transaction: {
            header: { ...bs.transaction.header, ...header },
            body: { ...bs.transaction.body }
        },
        stateSnapshotHash: bs.stateSnapshotHash,
        previousBlockHash: bs.previousBlockHash,
        messageBlocks: [...bs.messageBlocks]
    };
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
        postedAuditingData?: boolean;
    }> = {}
): DisputeStruct {
    const defaultDispute: DisputeStruct = {
        input: {
            channelId: ethers.hexlify(ethers.zeroPadBytes("0x00", 32)),
            forkId: ethers.hexlify(ethers.randomBytes(32)),
            latestStateSnapshotHash: ethers.hexlify(ethers.randomBytes(32)),
            latestInboundMessageBlockHash: hash(),
            lastInboundMessageBlockHeight: 0,
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

        outputSnapshotDataHash: ethers.hexlify(ethers.randomBytes(32)),
        postedAuditingData: false
    };
    const dispute = {
        input: {
            ...defaultDispute.input,
            ...overrides.input
        },
        outputSnapshotDataHash:
            overrides.outputSnapshotDataHash ||
            defaultDispute.outputSnapshotDataHash,
        postedAuditingData:
            overrides.postedAuditingData ?? defaultDispute.postedAuditingData
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
export function signedBlock(
    overrides: Partial<SignedBlockStruct> = {},
    signer?: HardhatEthersSigner
): SignedBlockStruct {
    const mockBlock = block(undefined, signer);
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
    overrides: Partial<MessageBlockStruct> = {}
): MessageBlockStruct {
    const defaultExitChannelBlock: MessageBlockStruct = {
        previousBlockHash: ethers.hexlify(ethers.randomBytes(32)),
        blockHeight: BigInt(randomInt(0, 1000)),
        messages: [],
        totalBalance: {
            amount: 0n,
            data: "0x"
        },
        timestamp: BigInt(Math.floor(Date.now() / 1000))
    };

    return {
        ...defaultExitChannelBlock,
        ...overrides,
        messages: overrides.messages ?? defaultExitChannelBlock.messages
    };
}

export function snapshotData(
    overrides: Partial<SnapshotDataStruct> = {}
): SnapshotDataStruct {
    return {
        originForkId: zeroHex(),
        stateMachineStateHash: zeroHex(),
        participants: [],
        latestInboundMessageBlockHash: zeroHex(),
        latestInboundMessageBlockHeight: 0n,
        latestOutboundMessageBlockHash: zeroHex(),
        latestOutboundMessageBlockHeight: 0n,
        totalDeposits: {
            amount: 0n,
            data: "0x"
        },
        totalWithdrawals: {
            amount: 0n,
            data: "0x"
        },
        ...overrides
    };
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
            latestInboundMessageBlockHash: hash(),
            latestInboundMessageBlockHeight: 0n,
            latestOutboundMessageBlockHash: hash(),
            latestOutboundMessageBlockHeight: 0n,
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
    const snapshotDataObj = {
        ...defaultStateSnapshot.snapshotData,
        ...overrides.snapshotData
    };
    const stateSnapshotObj = {
        ...defaultStateSnapshot,
        ...overrides,
        snapshotData: snapshotDataObj
    };

    return StateSnapshot.from(stateSnapshotObj as StateSnapshotStruct);
}

export function milestoneProof(
    forkId: ForkId,
    height: number = 0,
    overrides: Partial<StateProofStruct> = {}
): {
    forkId: ForkId;
    height: number;
    proof: StateProofStruct;
} {
    return {
        forkId,
        height,
        proof: {
            milestones: [
                {
                    blockConfirmations: [blockConfirmation()]
                }
            ],
            signedBlocks: [],
            ...overrides
        }
    };
}
