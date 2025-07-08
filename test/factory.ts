import { ethers } from "ethers";
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
    StateSnapshotStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import AgreementManager from "@/agreementManager";
import { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { randomInt } from "crypto";
import { Codec, Type } from "@/utils";
import { SignedDisputeStruct } from "@typechain-types/contracts/V1/StateChannelManagerInterface";

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
 * Creates an AgreementManager with a basic setup of one fork
 * @returns A pre-configured AgreementManager
 */
export function agreementManager(addresses: string[] = []): AgreementManager {
    const manager = new AgreementManager();
    // Initialize with a single fork
    const genesisState = ethers.hexlify(ethers.randomBytes(32));
    const participants = addresses || [
        ethers.Wallet.createRandom().address,
        ethers.Wallet.createRandom().address,
        ethers.Wallet.createRandom().address
    ];
    manager.newFork(
        genesisState,
        participants,
        ethers.hexlify(ethers.zeroPadBytes("0x00", 32)),
        Math.floor(Date.now() / 1000)
    );
    return manager;
}

/**
 * Creates a mock block for testing
 * @param overrides Optional overrides for the block properties
 * @returns A mock BlockStruct
 */
export function block(overrides: Partial<BlockStruct> = {}): BlockStruct {
    const block: BlockStruct = {
        transaction: transaction(),
        previousBlockHash: ethers.hexlify(ethers.randomBytes(32)),
        stateSnapshotHash: ethers.hexlify(ethers.randomBytes(32))
    };

    if (overrides.transaction) {
        block.transaction = transaction({
            ...block.transaction,
            ...overrides.transaction
        });
    }

    return { ...block, ...overrides };
}

/**
 * Creates a mock signature for testing
 * @returns A hex string representing a signature
 */
export function signature(): string {
    return ethers.hexlify(ethers.randomBytes(65));
}

/**
 * Creates a mock DisputeStruct for testing
 * @param overrides Optional override values for the dispute fields
 * @returns A DisputeStruct with default values and any provided overrides
 */
export function dispute(overrides: Partial<DisputeStruct> = {}): DisputeStruct {
    const defaultDispute: DisputeStruct = {
        channelId: ethers.hexlify(ethers.zeroPadBytes("0x00", 32)),
        genesisSnapshotDataHash: ethers.hexlify(ethers.randomBytes(32)),
        latestStateSnapshotHash: ethers.hexlify(ethers.randomBytes(32)),
        stateProof: {
            milestones: [],
            signedBlocks: []
        },
        fraudProofs: [],
        onChainSlashes: [],
        onChainLatestJoinChannelBlockHash: ethers.hexlify(
            ethers.randomBytes(32)
        ),
        outputSnapshotDataHash: ethers.hexlify(ethers.randomBytes(32)),
        disputeAuditingDataHash: ethers.hexlify(ethers.randomBytes(32)),
        disputer: ethers.ZeroAddress,
        timeout: {
            participant: ethers.ZeroAddress,
            blockHeight: 0,
            minTimeStamp: Math.floor(Date.now() / 1000),
            isForced: false,
            previousBlockProducer: ethers.ZeroAddress,
            previousBlockProducerPostedCalldata: false
        },
        selfRemoval: false
    };

    return { ...defaultDispute, ...overrides };
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
        encodedBlock: Codec.encode(mockBlock, Type.Block),
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

/**
 * Creates a mock BlockConfirmationStruct for testing
 * @param overrides Optional override values for the block confirmation fields
 * @returns A BlockConfirmationStruct with default values and any provided overrides
 */
export function blockConfirmation(
    overrides: Partial<BlockConfirmationStruct> = {}
): BlockConfirmationStruct {
    const defaultBlockConfirmation: BlockConfirmationStruct = {
        signedBlock: signedBlock(),
        signatures: [signature(), signature()]
    };

    return { ...defaultBlockConfirmation, ...overrides };
}

/**
 * Creates a mock ExitChannelBlockStruct for testing
 * @param overrides Optional override values for the exit channel block fields
 * @returns An ExitChannelBlockStruct with default values and any provided overrides
 */
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
    overrides: Partial<StateSnapshotStruct> = {}
): StateSnapshotStruct {
    const defaultStateSnapshot: StateSnapshotStruct = {
        snapshotData: {
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
        timestamp: Math.floor(Date.now() / 1000)
    };

    return { ...defaultStateSnapshot, ...overrides };
}
