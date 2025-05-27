import { ethers } from "ethers";
import {
    BlockStruct,
    TransactionStruct,
    TransactionHeaderStruct,
    TransactionBodyStruct,
    StateSnapshotStruct,
    BlockConfirmationStruct,
    SignedBlockStruct
} from "@typechain-types/contracts/V1/DataTypes";
import AgreementManager from "@/agreementManager";
import { DisputeStruct } from "@typechain-types/contracts/V1/DisputeTypes";

/**
 * Creates a default transaction header
 * @returns A transaction header with default values
 */
export function transactionHeader(
    overrides: Partial<TransactionHeaderStruct> = {}
): TransactionHeaderStruct {
    return {
        channelId: ethers.hexlify(ethers.zeroPadBytes("0x00", 32)),
        forkCnt: 0,
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
        0,
        Math.floor(Date.now() / 1000)
    );
    return manager;
}

/**
 * Creates a mock stateSnapshot for testing
 * @param overrides Optional overrides for the snapshot properties
 * @returns A mock StateSnapshotStruct
 */
export function stateSnapshot(
    overrides: Partial<StateSnapshotStruct> = {}
): StateSnapshotStruct {
    const defaultSnapshot: StateSnapshotStruct = {
        stateMachineStateHash: ethers.hexlify(ethers.randomBytes(32)),
        participants: [
            ethers.Wallet.createRandom().address,
            ethers.Wallet.createRandom().address
        ],
        forkCnt: 0,
        latestJoinChannelBlockHash: ethers.hexlify(ethers.randomBytes(32)),
        latestExitChannelBlockHash: ethers.hexlify(ethers.randomBytes(32)),
        totalDeposits: {
            amount: 0,
            data: ethers.toUtf8Bytes("")
        },
        totalWithdrawals: {
            amount: 0,
            data: ethers.toUtf8Bytes("")
        }
    };

    return { ...defaultSnapshot, ...overrides };
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
 * Creates a mock block confirmation for testing
 * @param a mock signed block
 * @returns A mock BlockConfirmationStruct
 */
export function blockConfirmation(
    overrides: SignedBlockStruct
): BlockConfirmationStruct {
    const defaultConfirmation: BlockConfirmationStruct = {
        signedBlock: overrides,
        signatures: []
    };

    return defaultConfirmation;
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
export function disputeStruct(
    overrides: Partial<DisputeStruct> = {}
): DisputeStruct {
    const defaultDispute: DisputeStruct = {
        channelId: ethers.hexlify(ethers.zeroPadBytes("0x00", 32)),
        genesisStateSnapshotHash: ethers.hexlify(ethers.randomBytes(32)),
        latestStateSnapshotHash: ethers.hexlify(ethers.randomBytes(32)),
        stateProof: {
            forkProof: { forkMilestoneProofs: [] },
            signedBlocks: []
        },
        fraudProofs: [],
        onChainSlashes: [],
        onChainLatestJoinChannelBlockHash: ethers.hexlify(
            ethers.randomBytes(32)
        ),
        outputStateSnapshotHash: ethers.hexlify(ethers.randomBytes(32)),
        exitChannelBlocks: [],
        disputeAuditingDataHash: ethers.hexlify(ethers.randomBytes(32)),
        disputer: ethers.ZeroAddress,
        disputeIndex: 0,
        previousRecursiveDisputeIndex: 0,
        timeout: {
            participant: ethers.ZeroAddress,
            blockHeight: 0,
            minTimeStamp: Math.floor(Date.now() / 1000),
            forkCnt: 0,
            isForced: false,
            previousBlockProducer: ethers.ZeroAddress,
            previousBlockProducerPostedCalldata: false
        },
        selfRemoval: false
    };

    return { ...defaultDispute, ...overrides };
}
