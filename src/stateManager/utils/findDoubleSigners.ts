import { Block } from "@/models";
import { Address, Signature } from "@/types/types";

/**
 * The signers whose signatures over `first` and over `second` both recover,
 * when the two are different blocks at one coordinate (fork and height),
 * other than `ownAddress`. Each of them signed two blocks at one height:
 * the chain's double-sign proof slashes it, author or co-signer. Empty for
 * one block or two coordinates. A signature that recovers no signer names
 * nobody.
 */
export function findDoubleSigners(
    first: Block,
    second: Block,
    ownAddress: Address
): Set<Address> {
    if (
        first.forkId !== second.forkId ||
        first.height !== second.height ||
        first.hash === second.hash
    )
        return new Set();
    const firstSigners = recoveredSigners(first);
    const doubleSigners = new Set<Address>();
    for (const signer of recoveredSigners(second))
        if (firstSigners.has(signer) && signer !== ownAddress)
            doubleSigners.add(signer);
    return doubleSigners;
}

function recoveredSigners(block: Block): Set<Address> {
    const signers = new Set<Address>();
    const signatures: Signature[] = [
        block.originalSignature,
        ...block.confirmationSignatures
    ];
    for (const signature of signatures) {
        try {
            signers.add(block.signatureToAddress(signature));
        } catch {
            // a signature the contracts reject names no signer
        }
    }
    return signers;
}
