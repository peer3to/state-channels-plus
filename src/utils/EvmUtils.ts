import { BytesLike, ethers, SignatureLike } from "ethers";
import {
    BlockStruct,
    JoinChannelStruct,
    SignedBlockStruct,
    SignedDisputeStruct,
    SignedJoinChannelStruct,
    TransactionStruct
} from "@typechain-types/contracts/V1/types/DataTypes";

import { SignatureUtils } from "./SignatureUtils";
import { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";

export class EvmUtils {
    public static async signTransaction(
        transaction: TransactionStruct,
        signer: ethers.Signer
    ): Promise<{ encodedTransaction: BytesLike; signature: string }> {
        const { encoded, signature } = await SignatureUtils.signTransaction(
            transaction,
            signer
        );
        return { encodedTransaction: encoded, signature };
    }

    public static async signBlock(
        block: BlockStruct,
        signer: ethers.Signer
    ): Promise<SignedBlockStruct> {
        const { encoded, signature } = await SignatureUtils.signBlock(
            block,
            signer
        );
        return { encodedBlock: encoded, signature };
    }

    public static async signDispute(
        dispute: DisputeStruct,
        signer: ethers.Signer
    ): Promise<SignedDisputeStruct> {
        const { encoded, signature } = await SignatureUtils.signDispute(
            dispute,
            signer
        );
        return { encodedDispute: encoded, signature } as SignedDisputeStruct;
    }

    public static retrieveSignerAddressBlock(
        block: BlockStruct,
        signature: SignatureLike
    ): string {
        return SignatureUtils.getSignerAddressBlock(block, signature);
    }

    public static async signJoinChannel(
        jc: JoinChannelStruct,
        signer: ethers.Signer
    ): Promise<SignedJoinChannelStruct> {
        const { encoded, signature } = await SignatureUtils.signJoinChannel(
            jc,
            signer
        );
        return { encodedJoinChannel: encoded, signature };
    }
    public static retrieveSignerAddressJoinChannel(
        jc: JoinChannelStruct,
        signature: SignatureLike
    ): string {
        return SignatureUtils.getSignerAddressJoinChannel(jc, signature);
    }
}
