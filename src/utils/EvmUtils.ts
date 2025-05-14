import { BytesLike, ethers, SignatureLike } from "ethers";
import {
    BlockStruct,
    JoinChannelStruct,
    SignedBlockStruct,
    SignedJoinChannelStruct,
    TransactionStruct
} from "@typechain-types/contracts/V1/DataTypes";

import { SignatureUtils } from "./SignatureUtils";
import { Codec } from "./Codec";

export class EvmUtils {
    public static async signTransaction(
        transaction: TransactionStruct,
        signer: ethers.Signer
    ): Promise<{ encodedTransaction: BytesLike; signature: string }> {
        const { encoded, signature } = await SignatureUtils.sign(
            transaction,
            signer
        );
        return { encodedTransaction: encoded, signature };
    }

    public static encodeBlock(block: BlockStruct): string {
        return Codec.encode(block);
    }

    public static decodeBlock(blockEncoded: BytesLike): BlockStruct {
        return Codec.decodeBlock(blockEncoded);
    }

    public static async signBlock(
        block: BlockStruct,
        signer: ethers.Signer
    ): Promise<SignedBlockStruct> {
        const { encoded, signature } = await SignatureUtils.sign(block, signer);
        return { encodedBlock: encoded, signature };
    }

    public static retrieveSignerAddressBlock(
        block: BlockStruct,
        signature: SignatureLike
    ): string {
        return SignatureUtils.getSignerAddressFromMsg(
            Codec.encode(block),
            signature
        );
    }

    public static encodeJoinChannel(jc: JoinChannelStruct): string {
        return Codec.encode(jc);
    }
    public static decodeJoinChannel(jcEncoded: BytesLike): JoinChannelStruct {
        return Codec.decodeJoinChannel(jcEncoded);
    }
    public static async signJoinChannel(
        jc: JoinChannelStruct,
        signer: ethers.Signer
    ): Promise<SignedJoinChannelStruct> {
        const { encoded, signature } = await SignatureUtils.sign(jc, signer);
        return { encodedJoinChannel: encoded, signature };
    }
    public static retrieveSignerAddressJoinChannel(
        jc: JoinChannelStruct,
        signature: SignatureLike
    ): string {
        return SignatureUtils.getSignerAddress(jc, signature);
    }
    //empty arrays '[]' can exist but not empty objects {} - Etheres is really bad for this with the Result object
    public static ethersResultToObjectRecursive(result: ethers.Result) {
        return Codec.ethersResultToObjectRecursive(result);
    }
}
