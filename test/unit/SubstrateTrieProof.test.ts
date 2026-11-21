import StorageProofError from "@/evm/p2pRuntime/rpcNodes/lightClient/proof/StorageProofError";
import SubstrateTrieProof from "@/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/SubstrateTrieProof";
import {
    craftedTrieNodes,
    hashedValueBranch,
    oneChildBranch,
    readCraftedTrie,
    twoEntryBranch
} from "@test/fixtures/lightClient/craftedTrieNodes";
import { moonbeamStorageProof } from "@test/fixtures/lightClient/moonbeamStorageProof";
import { expect } from "chai";
import { concat, dataLength, hexlify } from "ethers";

const { stateRoot, slots, sharedProofNodes, firstSlotProofNodes, account } =
    moonbeamStorageProof;
const [firstSlot, , emptySlot] = slots;
const ANY_KEY = "0x0a";
/** Longer than 32 bytes, so state version 1 holds it by hash. */
const LONG_VALUE = hexlify(new Uint8Array(40).fill(0xcd));
/** Eight key bytes: a partial key of 16 nibbles. */
const LONG_PARTIAL_KEY = "0x0102030405060708";

describe("SubstrateTrieProof", function () {
    it("reads a value the trie holds inside its leaf", function () {
        const value = new SubstrateTrieProof(sharedProofNodes).read(
            stateRoot,
            firstSlot.trieKey
        );
        expect(hexlify(value!)).to.equal(firstSlot.value);
    });

    it("reads a value the trie holds by hash", function () {
        expect(dataLength(account.value)).to.be.greaterThan(32);
        const value = new SubstrateTrieProof(account.proofNodes).read(
            stateRoot,
            account.trieKey
        );
        expect(hexlify(value!)).to.equal(account.value);
    });

    it("reads null for a key the proof shows to hold nothing", function () {
        expect(emptySlot.isStored).to.equal(false);
        const value = new SubstrateTrieProof(sharedProofNodes).read(
            stateRoot,
            emptySlot.trieKey
        );
        expect(value).to.equal(null);
    });

    it("reads null from the empty trie", function () {
        expect(readCraftedTrie(craftedTrieNodes.empty, ANY_KEY)).to.equal(null);
    });

    it("reads the value a branch holds where the key ends", function () {
        expect(hexlify(readCraftedTrie(twoEntryBranch, "0x")!)).to.equal(
            "0xaa"
        );
    });

    it("reads a value through a child its branch holds inside itself", function () {
        expect(hexlify(readCraftedTrie(twoEntryBranch, "0x12")!)).to.equal(
            "0xbb"
        );
    });

    it("reads null where the key ends at a branch that holds no value", function () {
        expect(readCraftedTrie(oneChildBranch, "0x")).to.equal(null);
    });

    it("reads null where a branch has no child for the key's next nibble", function () {
        expect(readCraftedTrie(twoEntryBranch, "0x22")).to.equal(null);
    });

    it("reads null where a leaf's partial key differs from the key", function () {
        expect(readCraftedTrie(twoEntryBranch, "0x13")).to.equal(null);
    });

    it("reads null where the key continues past a leaf", function () {
        expect(readCraftedTrie(twoEntryBranch, "0x1234")).to.equal(null);
    });

    it("reads null where the key ends inside a leaf's partial key", function () {
        // a leaf with the 4-nibble partial key 0a0b and value ff
        const leaf = "0x440a0b04ff";
        expect(hexlify(readCraftedTrie(leaf, "0x0a0b")!)).to.equal("0xff");
        expect(readCraftedTrie(leaf, "0x0a")).to.equal(null);
    });

    it("throws when any node on the key's path is left out of the proof", function () {
        expect(firstSlotProofNodes.length).to.be.greaterThan(1);
        for (const leftOut of firstSlotProofNodes) {
            const proof = new SubstrateTrieProof(
                firstSlotProofNodes.filter((node) => node !== leftOut)
            );
            expect(() => proof.read(stateRoot, firstSlot.trieKey)).to.throw(
                StorageProofError,
                /holds no node with hash/
            );
        }
    });

    it("throws when the bytes of any node on the key's path were changed", function () {
        for (const changed of firstSlotProofNodes) {
            const lastByte = changed.slice(-2) === "00" ? "01" : "00";
            const proof = new SubstrateTrieProof(
                firstSlotProofNodes.map((node) =>
                    node === changed ? node.slice(0, -2) + lastByte : node
                )
            );
            expect(() => proof.read(stateRoot, firstSlot.trieKey)).to.throw(
                StorageProofError,
                /holds no node with hash/
            );
        }
    });

    it("throws for a state root the proof does not lead to", function () {
        const proof = new SubstrateTrieProof(sharedProofNodes);
        expect(() =>
            proof.read(moonbeamStorageProof.blockHash, firstSlot.trieKey)
        ).to.throw(StorageProofError, /holds no node with hash/);
    });

    it("throws when the node holding a hashed value is left out", function () {
        const valueNode = account.proofNodes.find(
            (node) => node === account.value
        );
        expect(valueNode, "the proof carries the value as a node").to.not.be
            .undefined;
        const proof = new SubstrateTrieProof(
            account.proofNodes.filter((node) => node !== valueNode)
        );
        expect(() => proof.read(stateRoot, account.trieKey)).to.throw(
            StorageProofError,
            /holds no node with hash/
        );
    });

    it("reads the value a branch holds by hash where the key ends", function () {
        const { node, valueNode } = hashedValueBranch("0x", LONG_VALUE);
        const value = readCraftedTrie(node, "0x", [valueNode]);
        expect(hexlify(value!)).to.equal(LONG_VALUE);
        expect(hexlify(readCraftedTrie(node, "0x12", [valueNode])!)).to.equal(
            "0xbb"
        );
    });

    it("throws when the node holding a branch's hashed value is left out", function () {
        const { node } = hashedValueBranch("0x", LONG_VALUE);
        expect(() => readCraftedTrie(node, "0x")).to.throw(
            StorageProofError,
            /holds no node with hash/
        );
    });

    it("reads a branch that holds its value by hash under a partial key of 16 nibbles", function () {
        const { node, valueNode } = hashedValueBranch(
            LONG_PARTIAL_KEY,
            LONG_VALUE
        );
        expect(
            hexlify(readCraftedTrie(node, LONG_PARTIAL_KEY, [valueNode])!)
        ).to.equal(LONG_VALUE);
        expect(
            hexlify(
                readCraftedTrie(node, concat([LONG_PARTIAL_KEY, "0x12"]), [
                    valueNode
                ])!
            )
        ).to.equal("0xbb");
    });

    it("throws on a node with an unknown header", function () {
        expect(() =>
            readCraftedTrie(craftedTrieNodes.unknownHeader, ANY_KEY)
        ).to.throw(StorageProofError, /unknown header/);
    });

    it("throws on a node that ends before its announced content", function () {
        expect(() =>
            readCraftedTrie(craftedTrieNodes.truncatedLeaf, ANY_KEY)
        ).to.throw(StorageProofError, /ends early/);
    });

    it("throws on an odd partial key whose padding is not zero", function () {
        expect(() =>
            readCraftedTrie(craftedTrieNodes.paddedPartial, ANY_KEY)
        ).to.throw(StorageProofError, /padded partial key/);
    });

    it("throws on a branch that has no child", function () {
        expect(() =>
            readCraftedTrie(craftedTrieNodes.childlessBranch, ANY_KEY)
        ).to.throw(StorageProofError, /no child/);
    });

    it("throws on a value length nothing can hold", function () {
        expect(() =>
            readCraftedTrie(craftedTrieNodes.bigIntegerLength, ANY_KEY)
        ).to.throw(StorageProofError, /length nothing can hold/);
    });
});
