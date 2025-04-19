import { BytesLike, ethers } from "ethers";
import {
    BlockStruct,
    TransactionStruct,
    TransactionHeaderStruct,
    TransactionBodyStruct
} from "@typechain-types/contracts/V1/DataTypes";
import AgreementManager from "@/AgreementManager";

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
        transactionType: 1,
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
 * Creates a mock block for testing
 * @param overrides Optional overrides for the block properties
 * @returns A mock BlockStruct
 */
export function block(overrides: Partial<BlockStruct> = {}): BlockStruct {
    const block: BlockStruct = {
        transaction: transaction(),
        previousStateHash: ethers.hexlify(ethers.randomBytes(32)),
        stateHash: ethers.hexlify(ethers.randomBytes(32))
    };

    if (overrides.transaction) {
        block.transaction = transaction({
            ...block.transaction,
            ...overrides.transaction
        });
    }

    return { ...block, ...overrides };
}
