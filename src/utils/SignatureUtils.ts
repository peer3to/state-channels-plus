import { Signer, keccak256, getBytes } from "ethers";
import {
    JoinChannelStruct,
    OpenChannelStruct,
    TransactionStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { Block } from "@/models";
import { Codec, Type } from "./Codec";
import { Address, Bytes, Signature } from "@/types/types";
import { recoverSigner } from "@/cache";

export class SignatureUtils {
    public static signMsg(msg: Bytes, signer: Signer): Promise<Signature> {
        return signer.signMessage(getBytes(keccak256(msg)));
    }

    public static getSignerAddress(msg: Bytes, signature: Signature): Address {
        return recoverSigner(getBytes(keccak256(msg)), signature);
    }

    public static async signBlock(
        block: Block,
        signer: Signer
    ): Promise<{ encoded: Bytes; signature: Signature }> {
        const encoded = block.encode();
        const signature = await this.signMsg(encoded, signer);
        return { encoded, signature };
    }

    public static async signJoinChannel(
        joinChannel: JoinChannelStruct,
        signer: Signer
    ): Promise<{ encoded: Bytes; signature: Signature }> {
        const encoded = Codec.encode(joinChannel, Type.JoinChannel);
        const signature = await this.signMsg(encoded, signer);
        return { encoded, signature };
    }

    public static async signOpenChannel(
        openChannel: OpenChannelStruct,
        signer: Signer
    ): Promise<{ encoded: Bytes; signature: Signature }> {
        const encoded = Codec.encode(openChannel, Type.OpenChannel);
        const signature = await this.signMsg(encoded, signer);
        return { encoded, signature };
    }

    public static async signTransaction(
        transaction: TransactionStruct,
        signer: Signer
    ): Promise<{ encoded: Bytes; signature: Signature }> {
        const encoded = Codec.encode(transaction, Type.Transaction);
        const signature = await this.signMsg(encoded, signer);
        return { encoded, signature };
    }

    public static async signDispute(
        dispute: DisputeStruct,
        signer: Signer
    ): Promise<{ encoded: Bytes; signature: Signature }> {
        const encoded = Codec.encode(dispute, Type.Dispute);
        const signature = await this.signMsg(encoded, signer);
        return { encoded, signature };
    }

    public static getSignerAddressJoinChannel(
        joinChannel: JoinChannelStruct,
        signature: Signature | Bytes
    ): Address {
        const encoded = Codec.encode(joinChannel, Type.JoinChannel);
        return this.getSignerAddress(encoded, signature as Signature);
    }

    public static getSignerAddressTransaction(
        transaction: TransactionStruct,
        signature: Signature
    ): Address {
        const encoded = Codec.encode(transaction, Type.Transaction);
        return this.getSignerAddress(encoded, signature);
    }

    public static getSignerAddressDispute(
        dispute: DisputeStruct,
        signature: Signature
    ): Address {
        const encoded = Codec.encode(dispute, Type.Dispute);
        return this.getSignerAddress(encoded, signature);
    }

    public static hasSignatureThreshold(
        addressesInThreshold: Address[] | Set<Address>,
        data: Bytes,
        signatures: Signature[],
        options: {
            addressesToIgnore: Address[];
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
        const matchedAddresses = new Set<Address>();

        // Check each signature until we've matched all required addresses
        for (const sig of signatures) {
            // Skip verifying more signatures if we've already met the threshold
            if (matchedAddresses.size === requiredAddresses.size) {
                break;
            }

            try {
                // Get the signer address
                const signer = this.getSignerAddress(data, sig);

                // Skip if this address should be ignored
                if (ignoreSet.has(signer)) {
                    continue;
                }

                // If this signer is required for threshold, mark it as found
                if (requiredAddresses.has(signer)) {
                    matchedAddresses.add(signer);
                }
            } catch {
                // Skip invalid signatures
                continue;
            }
        }

        // If all required addresses have been found, we have met the threshold
        return matchedAddresses.size === requiredAddresses.size;
    }
}
