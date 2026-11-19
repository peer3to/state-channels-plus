// @spec-test-coverage-ignore: hand-encoded trie nodes used by the mapped SubstrateTrieProof, FrontierStorageProofVerifier and FrontierAccountProofVerifier declarations

import { encodeCompact } from "@/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/ScaleReader";
import { blake2b } from "@noble/hashes/blake2b";
import { concat, dataLength, getBytes, hexlify, toBeHex } from "ethers";

/** The state root of a trie whose only node is `encodedNode`. */
export function rootOfSingleNodeTrie(encodedNode: string): string {
    return hexlify(blake2b(getBytes(encodedNode), { dkLen: 32 }));
}

/**
 * The leaf node of a trie that holds one entry, which is also its root node.
 * `trieKey` must be shorter than 159 bytes.
 */
export function singleLeafNode(trieKey: string, value: string): string {
    const nibbleCount = dataLength(trieKey) * 2;
    // a partial key of 63 nibbles or more continues its count in a second byte
    const header =
        nibbleCount < 63 ? [0x40 | nibbleCount] : [0x7f, nibbleCount - 63];
    return concat([
        new Uint8Array(header),
        trieKey,
        encodeCompact(dataLength(value)),
        value
    ]);
}

/** A SCALE fixed-width unsigned integer of `length` bytes: little-endian. */
function encodeUnsigned(value: bigint, length: number): Uint8Array {
    return getBytes(toBeHex(value, length)).reverse();
}

/**
 * A hand-encoded `System.Account` entry: the nonce, the reference counts of
 * an account one provider keeps alive, and its balances.
 */
export function encodedAccountInfo(account: {
    nonce: bigint;
    free: bigint;
    reserved: bigint;
    frozen: bigint;
}): string {
    return concat([
        encodeUnsigned(account.nonce, 4),
        // consumers, providers, sufficients
        encodeUnsigned(0n, 4),
        encodeUnsigned(1n, 4),
        encodeUnsigned(0n, 4),
        encodeUnsigned(account.free, 16),
        encodeUnsigned(account.reserved, 16),
        encodeUnsigned(account.frozen, 16),
        // flags
        encodeUnsigned(1n << 127n, 16)
    ]);
}

/**
 * A hand-encoded trie of two entries in one node: a branch with no partial
 * key that holds `0xaa` for the empty key and, inside itself, the leaf of key
 * `0x12` with value `0xbb`.
 */
export const twoEntryBranch = "0xc0020004aa10410204bb";
/** The same branch without a value of its own: only key `0x12` is stored. */
export const oneChildBranch = "0x80020010410204bb";

/** Hand-encoded trie nodes a node of the chain would never produce. */
export const craftedTrieNodes = {
    /** The only node of the empty trie. */
    empty: "0x00",
    /** A header byte no kind of node uses. */
    unknownHeader: "0x01",
    /** A leaf that announces a 4-nibble partial key and ends after its header. */
    truncatedLeaf: "0x44",
    /** A leaf with a 1-nibble partial key (byte `1a`) whose padding nibble is not zero. */
    paddedPartial: "0x411a04ff",
    /** A branch with no partial key, no value and an empty child bitmap. */
    childlessBranch: "0x800000",
    /** A leaf whose value length is a SCALE big-integer compact. */
    bigIntegerLength: "0x4003"
};
