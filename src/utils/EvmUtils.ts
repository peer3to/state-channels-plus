import { BytesLike, ethers, SignatureLike } from "ethers";
import {
    BlockStruct,
    ExitChannelBlockStruct,
    ExitChannelStruct,
    JoinChannelBlockStruct,
    JoinChannelStruct,
    SignedBlockStruct,
    SignedJoinChannelStruct,
    StateSnapshotStruct,
    TransactionStruct
} from "@typechain-types/contracts/V1/DataTypes";
import {
    BlockEthersType,
    DisputeAuditingDataEthersType,
    ExitChannelBlockEthersType,
    ExitChannelEthersType,
    JoinChannelBlockEthersType,
    JoinChannelEthersType,
    StateSnapshotEthersType,
    TransactionEthersType
} from "@/types";
import { DisputeAuditingDataStruct } from "@typechain-types/contracts/V1/StateChannelManagerInterface";

export class EvmUtils {
    public static encodeTransaction(transaction: TransactionStruct): string {
        let transactionEncoded = ethers.AbiCoder.defaultAbiCoder().encode(
            [TransactionEthersType],
            [transaction]
        );
        return transactionEncoded;
    }

    public static decodeTransaction(
        transactionEncoded: BytesLike
    ): TransactionStruct {
        let transactionDecoded = ethers.AbiCoder.defaultAbiCoder().decode(
            [TransactionEthersType],
            transactionEncoded
        );
        return EvmUtils.ethersResultToObjectRecursive(
            transactionDecoded[0]
        ) as TransactionStruct;
    }

    public static encodeDisputeAuditingData(
        disputeAuditingData: DisputeAuditingDataStruct
    ): string {
        let disputeAuditingDataEncoded =
            ethers.AbiCoder.defaultAbiCoder().encode(
                [DisputeAuditingDataEthersType],
                [disputeAuditingData]
            );
        return disputeAuditingDataEncoded;
    }

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
        let blockDecoded = ethers.AbiCoder.defaultAbiCoder().decode(
            [BlockEthersType],
            blockEncoded
        );
        return EvmUtils.ethersResultToObjectRecursive(
            blockDecoded[0]
        ) as BlockStruct;
    }

    public static encodeStateSnapshot(
        stateSnapshot: StateSnapshotStruct
    ): string {
        let stateSnapshotEncoded = ethers.AbiCoder.defaultAbiCoder().encode(
            [StateSnapshotEthersType],
            [stateSnapshot]
        );
        return stateSnapshotEncoded;
    }

    public static async signBlock(
        block: BlockStruct,
        signer: ethers.Signer
    ): Promise<SignedBlockStruct> {
        const { encoded, signature } = await SignatureUtils.sign(block, signer);
        return { encodedBlock: encoded, signature };
    }

    public static async signDispute(
        dispute: DisputeStruct,
        signer: ethers.Signer
    ): Promise<SignedDisputeStruct> {
        const { encoded, signature } = await SignatureUtils.sign(
            dispute,
            signer
        );
        return { encodedDispute: encoded, signature };
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
        let joinChannelEncoded = ethers.AbiCoder.defaultAbiCoder().encode(
            [JoinChannelEthersType],
            [jc]
        );
        return joinChannelEncoded;
    }
    public static encodeJoinChannelBlock(jc: JoinChannelBlockStruct): string {
        let joinChannelEncoded = ethers.AbiCoder.defaultAbiCoder().encode(
            [JoinChannelBlockEthersType],
            [jc]
        );
        return joinChannelEncoded;
    }
    public static encodeExitChannel(ec: ExitChannelStruct): string {
        let exitChannelEncoded = ethers.AbiCoder.defaultAbiCoder().encode(
            [ExitChannelEthersType],
            [ec]
        );
        return exitChannelEncoded;
    }
    public static encodeExitChannelBlock(ec: ExitChannelBlockStruct): string {
        let exitChannelEncoded = ethers.AbiCoder.defaultAbiCoder().encode(
            [ExitChannelBlockEthersType],
            [ec]
        );
        return exitChannelEncoded;
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
