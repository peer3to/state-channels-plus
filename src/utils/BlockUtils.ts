import { BlockStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { EvmUtils } from "./EvmUtils";
import exp from "constants";
import { AddressLike, BytesLike, SignatureLike } from "ethers";
import { Codec, Type } from "./Codec";

export class BlockUtils {
    /**
     * Extract numeric fields from a block and convert them to regular number types
     */
    public static getCoordinates(block: BlockStruct) {
        return {
            forkId: block.transaction.header.forkId,
            height: Number(block.transaction.header.transactionCnt)
        };
    }

    /**
     * Get the block height (transaction count) from a block
     */
    public static getHeight(block: BlockStruct): number {
        return Number(block.transaction.header.transactionCnt);
    }

    /**
     * Get the fork number from a block
     */
    public static getFork(block: BlockStruct): ForkId {
        return block.transaction.header.forkId;
    }

    /**
     * Get the timestamp from a block
     */
    public static getTimestamp(block: BlockStruct): number {
        return Number(block.transaction.header.timestamp);
    }

    public static getBlockAuthor(block: BlockStruct): string {
        return block.transaction.header.participant as string;
    }

    public static getChannelId(block: BlockStruct): string {
        return block.transaction.header.channelId as string;
    }

    public static areBlocksEqual(b1: BlockStruct, b2: BlockStruct): boolean {
        return Codec.encode(b1, Type.Block) === Codec.encode(b2, Type.Block);
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
