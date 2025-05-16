import { AddressLike, BytesLike, ethers, SignatureLike } from "ethers";

import { Codec } from "./Codec";

export class SignatureUtils {
    public static signMsg(
        msg: BytesLike,
        signer: ethers.Signer
    ): Promise<string> {
        const hash = ethers.keccak256(msg);
        const encodedHashBytes = ethers.getBytes(hash);
        return signer.signMessage(encodedHashBytes);
    }

    public static getSignerAddressFromMsg(
        msg: BytesLike,
        signature: SignatureLike
    ): string {
        return ethers.verifyMessage(
            ethers.getBytes(ethers.keccak256(msg)),
            signature
        );
    }

    public static getSignerAddress(obj: any, signature: SignatureLike): string {
        const encoded = Codec.encode(obj);
        return this.getSignerAddressFromMsg(encoded, signature);
    }

    public static async sign(
        obj: any,
        signer: ethers.Signer
    ): Promise<{ encoded: BytesLike; signature: string }> {
        const encoded = Codec.encode(obj);
        const signature = await this.signMsg(encoded, signer);
        return { encoded, signature };
    }

    public static hasSignatureThreshold(
        addressesInThreshold: AddressLike[],
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

        // Create a Set of required addresses
        const requiredAddresses = new Set(addressesInThreshold);

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
                const signer = this.getSignerAddressFromMsg(
                    data,
                    sig
                ) as AddressLike;

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
