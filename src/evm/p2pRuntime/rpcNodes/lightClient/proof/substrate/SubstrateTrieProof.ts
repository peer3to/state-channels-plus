import ScaleReader from "./ScaleReader";
import StorageProofError from "../StorageProofError";
import type { Bytes, Hash } from "@/types/types";
import { blake2b } from "@noble/hashes/blake2b";
import { getBytes, hexlify } from "ethers";

/** 0x-prefixed hex of a trie node's Blake2-256 hash. */
type NodeHash = string;
/** Half a key byte, 0 to 15: the trie branches on one nibble at a time. */
type Nibble = number;

/** A value held in its node, or the hash of the proof node that holds it. */
type TrieValue = { inline: Uint8Array } | { hash: Uint8Array };

type TrieNode =
    | { kind: "empty" }
    | { kind: "leaf"; partial: Nibble[]; value: TrieValue }
    | {
          kind: "branch";
          partial: Nibble[];
          value?: TrieValue;
          /** By nibble: an encoded node shorter than a hash, or a node hash. */
          children: (Uint8Array | undefined)[];
      };

const HASH_LENGTH = 32;
const CHILD_COUNT = 16;
const BITMAP_LENGTH = 2;

/** Substrate's hash, BlakeTwo256: of a trie node, and of a header. */
export const blake2_256 = (data: Uint8Array) =>
    blake2b(data, { dkLen: HASH_LENGTH });

function toNibbles(bytes: Uint8Array, skipFirst = false): Nibble[] {
    const nibbles: Nibble[] = [];
    for (const byte of bytes) nibbles.push(byte >> 4, byte & 0x0f);
    return skipFirst ? nibbles.slice(1) : nibbles;
}

/** Reads one encoded trie node front to back. */
class NodeReader extends ScaleReader {
    constructor(encodedNode: Uint8Array) {
        super(encodedNode, "A proof node");
    }

    /**
     * The nibble count of a node's partial key: the header bits left of
     * `prefixBits`, continued in the next bytes when those bits are all set.
     */
    readNibbleCount(header: number, prefixBits: number): number {
        const max = 0xff >> prefixBits;
        let count = header & max;
        if (count < max) return count;
        count -= 1;
        for (;;) {
            const next = this.readByte();
            if (next < 0xff) return count + next + 1;
            count += 0xff;
        }
    }

    readPartial(nibbleCount: number): Nibble[] {
        const isOdd = nibbleCount % 2 !== 0;
        const bytes = this.take(Math.ceil(nibbleCount / 2));
        if (isOdd && bytes[0] >> 4 !== 0)
            throw new StorageProofError(
                "A proof node has a padded partial key"
            );
        return toNibbles(bytes, isOdd);
    }

    readValue(isHashed: boolean): TrieValue {
        return isHashed
            ? { hash: this.take(HASH_LENGTH) }
            : { inline: this.take(this.readCompactLength()) };
    }
}

function decodeBranch(
    reader: NodeReader,
    partial: Nibble[],
    valueKind: "none" | "inline" | "hashed"
): TrieNode {
    const bitmapBytes = reader.take(BITMAP_LENGTH);
    const bitmap = bitmapBytes[0] | (bitmapBytes[1] << 8);
    if (bitmap === 0)
        throw new StorageProofError("A proof branch node has no child");
    const value =
        valueKind === "none"
            ? undefined
            : reader.readValue(valueKind === "hashed");
    const children: (Uint8Array | undefined)[] = [];
    for (let nibble = 0; nibble < CHILD_COUNT; nibble++) {
        const hasChild = (bitmap & (1 << nibble)) !== 0;
        children.push(
            hasChild ? reader.take(reader.readCompactLength()) : undefined
        );
    }
    return { kind: "branch", partial, value, children };
}

/** Decodes a node of the Substrate state trie, as `sp-trie`'s `NodeCodec`. */
function decodeNode(encodedNode: Uint8Array): TrieNode {
    const reader = new NodeReader(encodedNode);
    const header = reader.readByte();
    if (header === 0) return { kind: "empty" };
    const partialOf = (prefixBits: number) =>
        reader.readPartial(reader.readNibbleCount(header, prefixBits));
    switch (header >> 6) {
        case 0b01: {
            const partial = partialOf(2);
            return { kind: "leaf", partial, value: reader.readValue(false) };
        }
        case 0b10:
            return decodeBranch(reader, partialOf(2), "none");
        case 0b11:
            return decodeBranch(reader, partialOf(2), "inline");
        default:
            break;
    }
    // state version 1: the node holds the hash of a value longer than 32 bytes
    if (header >> 5 === 0b001) {
        const partial = partialOf(3);
        return { kind: "leaf", partial, value: reader.readValue(true) };
    }
    if (header >> 4 === 0b0001)
        return decodeBranch(reader, partialOf(4), "hashed");
    throw new StorageProofError("A proof node has an unknown header");
}

/**
 * A Substrate read proof (`state_getReadProof`): the nodes of a Blake2-256
 * state trie on the paths to the proven keys. Reads state version 1 nodes and
 * the version 0 nodes a migrating chain still holds.
 */
export default class SubstrateTrieProof {
    private readonly nodesByHash = new Map<NodeHash, Uint8Array>();

    constructor(proofNodes: Bytes[]) {
        for (const proofNode of proofNodes) {
            const encodedNode = getBytes(proofNode);
            this.nodesByHash.set(hexlify(blake2_256(encodedNode)), encodedNode);
        }
    }

    /**
     * The value at `key` in the trie with root `stateRoot`, or `null` when the
     * proof shows the key holds nothing. Throws {@link StorageProofError} when
     * the proof does not reach the key or a node on its path is malformed.
     */
    read(stateRoot: Hash, key: Bytes): Uint8Array | null {
        const keyNibbles = toNibbles(getBytes(key));
        let encodedNode = this.nodeWithHash(getBytes(stateRoot));
        let position = 0;
        for (;;) {
            const node = decodeNode(encodedNode);
            if (node.kind === "empty") return null;
            const continuesKey = node.partial.every(
                (nibble, index) => keyNibbles[position + index] === nibble
            );
            if (!continuesKey) return null;
            position += node.partial.length;
            const isKeyEnd = position === keyNibbles.length;
            if (node.kind === "leaf")
                return isKeyEnd ? this.valueOf(node.value) : null;
            if (isKeyEnd) return node.value ? this.valueOf(node.value) : null;
            const child = node.children[keyNibbles[position]];
            if (!child) return null;
            position += 1;
            encodedNode =
                child.length === HASH_LENGTH ? this.nodeWithHash(child) : child;
        }
    }

    private valueOf(value: TrieValue): Uint8Array {
        return "inline" in value ? value.inline : this.nodeWithHash(value.hash);
    }

    private nodeWithHash(hash: Uint8Array): Uint8Array {
        const encodedNode = this.nodesByHash.get(hexlify(hash));
        if (!encodedNode)
            throw new StorageProofError(
                `The proof holds no node with hash ${hexlify(hash)}`
            );
        return encodedNode;
    }
}
