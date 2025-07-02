import { AddressLike, BytesLike, ethers, SignatureLike } from "ethers";
import {
    BlockStruct,
    JoinChannelStruct,
    TransactionStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";

import { Codec, Type } from "./Codec";

export class SignatureUtils {
    public static signMsg(
        msg: BytesLike,
        signer: ethers.Signer
    ): Promise<string> {
        const hash = ethers.keccak256(msg);
        const encodedHashBytes = ethers.getBytes(hash);
        return signer.signMessage(encodedHashBytes);
    }

    public static getSignerAddress(
        msg: BytesLike,
        signature: SignatureLike
    ): string {
        return ethers.verifyMessage(
            ethers.getBytes(ethers.keccak256(msg)),
            signature
        );
    }

    public static async signBlock(
        block: BlockStruct,
        signer: ethers.Signer
    ): Promise<{ encoded: BytesLike; signature: string }> {
        const encoded = Codec.encode(block, Type.Block);
        const signature = await this.signMsg(encoded, signer);
        return { encoded, signature };
    }

    public static async signJoinChannel(
        joinChannel: JoinChannelStruct,
        signer: ethers.Signer
    ): Promise<{ encoded: BytesLike; signature: string }> {
        const encoded = Codec.encode(joinChannel, Type.JoinChannel);
        const signature = await this.signMsg(encoded, signer);
        return { encoded, signature };
    }

    public static async signTransaction(
        transaction: TransactionStruct,
        signer: ethers.Signer
    ): Promise<{ encoded: BytesLike; signature: string }> {
        const encoded = Codec.encode(transaction, Type.Transaction);
        const signature = await this.signMsg(encoded, signer);
        return { encoded, signature };
    }

    public static async signDispute(
        dispute: DisputeStruct,
        signer: ethers.Signer
    ): Promise<{ encoded: BytesLike; signature: string }> {
        const encoded = Codec.encode(dispute, Type.Dispute);
        const signature = await this.signMsg(encoded, signer);
        return { encoded, signature };
    }

    public static getSignerAddressBlock(
        block: BlockStruct,
        signature: SignatureLike
    ): string {
        const encoded = Codec.encode(block, Type.Block);
        return this.getSignerAddress(encoded, signature);
    }

    public static getSignerAddressJoinChannel(
        joinChannel: JoinChannelStruct,
        signature: SignatureLike
    ): string {
        const encoded = Codec.encode(joinChannel, Type.JoinChannel);
        return this.getSignerAddress(encoded, signature);
    }

    public static getSignerAddressTransaction(
        transaction: TransactionStruct,
        signature: SignatureLike
    ): string {
        const encoded = Codec.encode(transaction, Type.Transaction);
        return this.getSignerAddress(encoded, signature);
    }

    public static getSignerAddressDispute(
        dispute: DisputeStruct,
        signature: SignatureLike
    ): string {
        const encoded = Codec.encode(dispute, Type.Dispute);
        return this.getSignerAddress(encoded, signature);
    }

    public static hasSignatureThreshold(
        addressesInThreshold: AddressLike[] | Set<AddressLike>,
        data: BytesLike,
        signatures: SignatureLike[],
        options: {
            addressesToIgnore: AddressLike[];
        } = {
            addressesToIgnore: []
        }
    ): boolean {
        // Create a Set of addresses to ignore (for O(1) lookups)
        const ignoreSet = new Set(options.addressesToIgnore);

        // Create a Set of required addresses (or use existing Set)
        const requiredAddresses =
            addressesInThreshold instanceof Set
                ? addressesInThreshold
                : new Set(addressesInThreshold);

        // Create a Set to track which threshold addresses we've found
        const matchedAddresses = new Set<AddressLike>();

        // Check each signature until we've matched all required addresses
        for (const sig of signatures) {
            // Skip verifying more signatures if we've already met the threshold
            if (matchedAddresses.size === requiredAddresses.size) {
                break;
            }

            try {
                // Get the signer address
                const signer = this.getSignerAddress(data, sig) as AddressLike;

                // Skip if this address should be ignored
                if (ignoreSet.has(signer)) {
                    continue;
                }

                // If this signer is required for threshold, mark it as found
                if (requiredAddresses.has(signer)) {
                    matchedAddresses.add(signer);
                }
            } catch (e) {
                // Skip invalid signatures
                continue;
            }
        }

        // If all required addresses have been found, we have met the threshold
        return matchedAddresses.size === requiredAddresses.size;
    }
}
