import StorageProofError from "@/evm/p2pRuntime/rpcNodes/lightClient/proof/StorageProofError";
import { encodeCompact } from "@/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/ScaleReader";
import SubstrateTrieProof from "@/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/SubstrateTrieProof";
import {
    ANY_TRIE_KEY,
    craftedTrieNodes,
    oneChildBranch,
    patternedValue,
    readCrafted,
    readFromSingleLeaf,
    singleLeafNode,
    twoEntryBranch
} from "@test/fixtures/lightClient/craftedTrieNodes";
import { moonbeamStorageProof } from "@test/fixtures/lightClient/moonbeamStorageProof";
import { expect } from "chai";
import { dataLength, hexlify } from "ethers";

const { stateRoot, slots, sharedProofNodes, firstSlotProofNodes, account } =
    moonbeamStorageProof;
const [firstSlot, , emptySlot] = slots;

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

    it("reads a value of more than 32 bytes a state version 0 leaf holds inline, its length in two bytes", function () {
        const value = patternedValue(100);
        // version 0 never hashes a value: the leaf holds all 100 bytes
        expect(encodeCompact(100)).to.have.length(2);
        expect(
            dataLength(singleLeafNode(ANY_TRIE_KEY, value))
        ).to.be.greaterThan(100);
        expect(readFromSingleLeaf(value)).to.equal(value);
    });

    it("reads values of 63 and 64 bytes, either side of the one-byte length form", function () {
        expect(encodeCompact(63)).to.have.length(1);
        expect(encodeCompact(64)).to.have.length(2);
        for (const length of [63, 64]) {
            const value = patternedValue(length);
            expect(readFromSingleLeaf(value), `${length} bytes`).to.equal(
                value
            );
        }
    });

    it("reads values of 16383 and 16384 bytes, either side of the two-byte length form", function () {
        expect(encodeCompact(16383)).to.have.length(2);
        expect(encodeCompact(16384)).to.have.length(4);
        for (const length of [16383, 16384]) {
            const value = patternedValue(length);
            expect(readFromSingleLeaf(value), `${length} bytes`).to.equal(
                value
            );
        }
    });

    it("reads a value whose length takes the four-byte length form", function () {
        const value = patternedValue(70000);
        expect(encodeCompact(70000)).to.have.length(4);
        expect(readFromSingleLeaf(value)).to.equal(value);
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
        expect(readCrafted(craftedTrieNodes.empty)).to.equal(null);
    });

    it("reads the value a branch holds where the key ends", function () {
        expect(hexlify(readCrafted(twoEntryBranch, "0x")!)).to.equal("0xaa");
    });

    it("reads a value through a child its branch holds inside itself", function () {
        expect(hexlify(readCrafted(twoEntryBranch, "0x12")!)).to.equal("0xbb");
    });

    it("reads null where the key ends at a branch that holds no value", function () {
        expect(readCrafted(oneChildBranch, "0x")).to.equal(null);
    });

    it("reads null where a branch has no child for the key's next nibble", function () {
        expect(readCrafted(twoEntryBranch, "0x22")).to.equal(null);
    });

    it("reads null where a leaf's partial key differs from the key", function () {
        expect(readCrafted(twoEntryBranch, "0x13")).to.equal(null);
    });

    it("reads null where the key continues past a leaf", function () {
        expect(readCrafted(twoEntryBranch, "0x1234")).to.equal(null);
    });

    it("reads null where the key ends inside a leaf's partial key", function () {
        // a leaf with the 4-nibble partial key 0a0b and value ff
        const leaf = "0x440a0b04ff";
        expect(hexlify(readCrafted(leaf, "0x0a0b")!)).to.equal("0xff");
        expect(readCrafted(leaf, "0x0a")).to.equal(null);
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

    it("throws on a node with an unknown header", function () {
        expect(() => readCrafted(craftedTrieNodes.unknownHeader)).to.throw(
            StorageProofError,
            /unknown header/
        );
    });

    it("throws on a node that ends before its announced content", function () {
        expect(() => readCrafted(craftedTrieNodes.truncatedLeaf)).to.throw(
            StorageProofError,
            /ends early/
        );
    });

    it("throws on an odd partial key whose padding is not zero", function () {
        expect(() => readCrafted(craftedTrieNodes.paddedPartial)).to.throw(
            StorageProofError,
            /padded partial key/
        );
    });

    it("throws on a branch that has no child", function () {
        expect(() => readCrafted(craftedTrieNodes.childlessBranch)).to.throw(
            StorageProofError,
            /no child/
        );
    });

    it("throws on a value length nothing can hold", function () {
        expect(() => readCrafted(craftedTrieNodes.bigIntegerLength)).to.throw(
            StorageProofError,
            /length nothing can hold/
        );
    });
});
