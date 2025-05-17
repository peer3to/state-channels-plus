import {
    BlockStruct,
    SignedBlockStruct
} from "@typechain-types/contracts/V1/DataTypes";
import { EvmUtils } from "./EvmUtils";
import exp from "constants";
import { AddressLike, SignatureLike } from "ethers";

export class BlockUtils {
    /**
     * Extract numeric fields from a block and convert them to regular number types
     */
    public static getCoordinates(block: BlockStruct) {
        return {
            forkCnt: Number(block.transaction.header.forkCnt),
            height: Number(block.transaction.header.transactionCnt)
        };
    }

    /**
     * Get the block height (transaction count) from a block
     */
    public static getHeight(signedBlock: SignedBlockStruct): number {
        const block = EvmUtils.decodeBlock(signedBlock.encodedBlock);
        return Number(block.transaction.header.transactionCnt);
    }

    /**
     * Get the fork number from a block
     */
    public static getFork(signedBlock: SignedBlockStruct): number {
        const block = EvmUtils.decodeBlock(signedBlock.encodedBlock);
        return Number(block.transaction.header.forkCnt);
    }

    /**
     * Get the timestamp from a block
     */
    public static getTimestamp(signedBlock: SignedBlockStruct): number {
        const block = EvmUtils.decodeBlock(signedBlock.encodedBlock);
        return Number(block.transaction.header.timestamp);
    }

    public static getBlockAuthor(signedBlock: SignedBlockStruct): string {
        const block = EvmUtils.decodeBlock(signedBlock.encodedBlock);
        return EvmUtils.retrieveSignerAddressBlock(
            block,
            signedBlock.signature as SignatureLike
        );
    }

    public static getChannelId(block: BlockStruct): string {
        return block.transaction.header.channelId as string;
    }

    public static areBlocksEqual(b1: BlockStruct, b2: BlockStruct): boolean {
        return EvmUtils.encodeBlock(b1) === EvmUtils.encodeBlock(b2);
    }

    public static getSignerAddresses(
        block: BlockStruct,
        signatures: SignatureLike[]
    ): Set<string> {
        return new Set(
            signatures.map((sig) =>
                EvmUtils.retrieveSignerAddressBlock(block, sig)
            )
        );
    }

    public static getParticipantSignature(
        block: BlockStruct,
        signatures: SignatureLike[],
        participant: AddressLike
    ): { didSign: boolean; signature: SignatureLike | undefined } {
        for (const sig of signatures) {
            if (
                EvmUtils.retrieveSignerAddressBlock(block, sig) === participant
            ) {
                return { didSign: true, signature: sig };
            }
        }
        return { didSign: false, signature: undefined };
    }
}
