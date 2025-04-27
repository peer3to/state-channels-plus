import { BlockStruct } from "@typechain-types/contracts/V1/DataTypes";
import EvmUtils from "./EvmUtils";

/**
 * Extract numeric fields from a block and convert them to regular number types
 */
export const coordinatesOf = (block: BlockStruct) => ({
    forkCnt: Number(block.transaction.header.forkCnt),
    height: Number(block.transaction.header.transactionCnt)
});

/**
 * Get the block height (transaction count) from a block
 */
export const heightOf = (block: BlockStruct): number =>
    Number(block.transaction.header.transactionCnt);

/**
 * Get the fork number from a block
 */
export const forkOf = (block: BlockStruct): number =>
    Number(block.transaction.header.forkCnt);

/**
 * Get the timestamp from a block
 */
export const timestampOf = (block: BlockStruct): number =>
    Number(block.transaction.header.timestamp);

export const participantOf = (block: BlockStruct): string =>
    block.transaction.header.participant as string;

export const channelIdOf = (block: BlockStruct): string =>
    block.transaction.header.channelId as string;

/**
 * Convert all "Like" fields in a block to regular TypeScript types
 */
export const normalized = (block: BlockStruct) => ({
    transaction: {
        header: {
            channelId: block.transaction.header.channelId as string,
            participant: block.transaction.header.participant as string,
            timestamp: Number(block.transaction.header.timestamp),
            forkCnt: Number(block.transaction.header.forkCnt),
            transactionCnt: Number(block.transaction.header.transactionCnt)
        },
        body: {
            transactionType: Number(block.transaction.body.transactionType),
            encodedData: block.transaction.body.encodedData as string,
            data: block.transaction.body.data as string
        }
    },
    stateHash: block.stateHash as string,
    previousStateHash: block.previousStateHash as string
});

export const isSameBlock = (b1: BlockStruct, b2: BlockStruct): boolean =>
    EvmUtils.encodeBlock(b1) === EvmUtils.encodeBlock(b2);
