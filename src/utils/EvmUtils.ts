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
    ExitChannelBlockEthersType,
    ExitChannelEthersType,
    JoinChannelBlockEthersType,
    JoinChannelEthersType,
    StateSnapshotEthersType,
    TransactionEthersType
} from "@/types";

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

    public static async signTransaction(
        transaction: TransactionStruct,
        signer: ethers.Signer
    ): Promise<{ encodedTransaction: BytesLike; signature: string }> {
        let encodedTransaction = EvmUtils.encodeTransaction(transaction);
        let encodedHash = ethers.keccak256(encodedTransaction);
        let econdedHashBytes = ethers.getBytes(encodedHash);
        let signature = await signer.signMessage(econdedHashBytes);
        return { encodedTransaction: encodedTransaction, signature };
    }

    public static encodeBlock(block: BlockStruct): string {
        let blockEncoded = ethers.AbiCoder.defaultAbiCoder().encode(
            [BlockEthersType],
            [block]
        );
        return blockEncoded;
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
        let encodedBlock = EvmUtils.encodeBlock(block);
        let encodedHash = ethers.keccak256(encodedBlock);
        let econdedHashBytes = ethers.getBytes(encodedHash);
        let signature = await signer.signMessage(econdedHashBytes);
        return { encodedBlock: encodedBlock, signature };
    }

    public static retrieveSignerAddressBlock(
        block: BlockStruct,
        signature: SignatureLike
    ): string {
        let encodedBlock = EvmUtils.encodeBlock(block);
        let encodedHash = ethers.keccak256(encodedBlock);
        let econdedHashBytes = ethers.getBytes(encodedHash);
        return ethers.verifyMessage(econdedHashBytes, signature);
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
        let jcDecoded = ethers.AbiCoder.defaultAbiCoder().decode(
            [JoinChannelEthersType],
            jcEncoded
        );
        return EvmUtils.ethersResultToObjectRecursive(
            jcDecoded[0]
        ) as JoinChannelStruct;
    }
    public static async signJoinChannel(
        jc: JoinChannelStruct,
        signer: ethers.Signer
    ): Promise<SignedJoinChannelStruct> {
        let encodedJoinChannel = EvmUtils.encodeJoinChannel(jc);
        let encodedHash = ethers.keccak256(encodedJoinChannel);
        let econdedHashBytes = ethers.getBytes(encodedHash);
        let signature = await signer.signMessage(econdedHashBytes);
        return { encodedJoinChannel, signature };
    }
    public static retrieveSignerAddressJoinChannel(
        jc: JoinChannelStruct,
        signature: SignatureLike
    ): string {
        let encodedJoinChannel = EvmUtils.encodeJoinChannel(jc);
        let encodedHash = ethers.keccak256(encodedJoinChannel);
        let econdedHashBytes = ethers.getBytes(encodedHash);
        return ethers.verifyMessage(econdedHashBytes, signature);
    }
    //empty arrays '[]' can exist but not empty objects {} - Etheres is really bad for this with the Result object
    public static ethersResultToObjectRecursive(result: ethers.Result) {
        let obj: Record<string, any> = {};
        try {
            obj = result.toObject();
            let cnt = 0;
            for (let key in obj) {
                if (key == "_") obj = result.toArray();
                cnt++;
            }
            if (cnt == 0) obj = result.toArray();
        } catch (e) {
            obj = result.toArray();
        }
        for (let key in obj) {
            if (
                obj[key] instanceof ethers.Result &&
                Object.getPrototypeOf(obj[key]) === ethers.Result.prototype
            ) {
                obj[key] = EvmUtils.ethersResultToObjectRecursive(obj[key]);
            }
        }
        return obj;
    }
}
