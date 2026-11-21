import StorageProofError from "@/evm/p2pRuntime/rpcNodes/lightClient/proof/StorageProofError";
import FrontierStorageProofVerifier from "@/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/FrontierStorageProofVerifier";
import {
    rootOfSingleNodeTrie,
    singleLeafNode
} from "@test/fixtures/lightClient/craftedTrieNodes";
import { moonbeamStorageProof } from "@test/fixtures/lightClient/moonbeamStorageProof";
import { peer3StorageProof } from "@test/fixtures/lightClient/peer3StorageProof";
import { expect } from "chai";
import { ZeroHash } from "ethers";

const { stateRoot, address, slots, sharedProofNodes, firstSlotProofNodes } =
    moonbeamStorageProof;
const [firstSlot, secondSlot, emptySlot] = slots;
const verifier = new FrontierStorageProofVerifier();

describe("FrontierStorageProofVerifier", function () {
    it("proves a stored slot to the value the chain's eth_getStorageAt returned", function () {
        expect(firstSlot.isStored).to.equal(true);
        const [value] = verifier.provenStorage(
            stateRoot,
            address,
            [firstSlot.slot],
            firstSlotProofNodes
        );
        expect(value).to.equal(firstSlot.value);
    });

    it("proves a slot the chain stores no entry for as zero", function () {
        expect(emptySlot.isStored).to.equal(false);
        const [value] = verifier.provenStorage(
            stateRoot,
            address,
            [emptySlot.slot],
            sharedProofNodes
        );
        expect(value).to.equal(ZeroHash);
    });

    it("proves several slots from one shared proof, in the order asked", function () {
        const asked = [slots[3], slots[1], slots[0], slots[2]];
        const values = verifier.provenStorage(
            stateRoot,
            address,
            asked.map(({ slot }) => slot),
            sharedProofNodes
        );
        expect(values).to.deep.equal(asked.map(({ value }) => value));
    });

    it("throws for a slot the proof was not built for", function () {
        expect(() =>
            verifier.provenStorage(
                stateRoot,
                address,
                [secondSlot.slot],
                firstSlotProofNodes
            )
        ).to.throw(StorageProofError, /holds no node with hash/);
    });

    it("throws when one of several slots is not proven", function () {
        expect(() =>
            verifier.provenStorage(
                stateRoot,
                address,
                [firstSlot.slot, secondSlot.slot],
                firstSlotProofNodes
            )
        ).to.throw(StorageProofError, /holds no node with hash/);
    });

    it("throws when the proven value is not 32 bytes long", function () {
        const shortNode = singleLeafNode(
            firstSlot.trieKey,
            "0x" + "11".repeat(31)
        );
        expect(() =>
            verifier.provenStorage(
                rootOfSingleNodeTrie(shortNode),
                address,
                [firstSlot.slot],
                [shortNode]
            )
        ).to.throw(StorageProofError, /31-byte value/);

        // the same one-entry trie with a 32-byte value is accepted
        const fullValue = "0x" + "11".repeat(32);
        const fullNode = singleLeafNode(firstSlot.trieKey, fullValue);
        expect(
            verifier.provenStorage(
                rootOfSingleNodeTrie(fullNode),
                address,
                [firstSlot.slot],
                [fullNode]
            )
        ).to.deep.equal([fullValue]);
    });

    it("refuses an address that is not 20 bytes", function () {
        expect(() =>
            verifier.provenStorage(
                stateRoot,
                address.slice(0, -2),
                [firstSlot.slot],
                sharedProofNodes
            )
        ).to.throw(/an address is 20 bytes/);
    });

    it("refuses a slot that is not 32 bytes", function () {
        expect(() =>
            verifier.provenStorage(
                stateRoot,
                address,
                [firstSlot.slot.slice(0, -2)],
                sharedProofNodes
            )
        ).to.throw(/a storage slot is 32 bytes/);
    });

    it("proves slots written on a peer3 dev node to the node's own reads", function () {
        const { afterWrites } = peer3StorageProof;
        expect(afterWrites.values[0]).to.not.equal(ZeroHash);
        expect(afterWrites.values[1]).to.not.equal(ZeroHash);
        expect(
            verifier.provenStorage(
                afterWrites.stateRoot,
                peer3StorageProof.address,
                peer3StorageProof.slots,
                afterWrites.proofNodes
            )
        ).to.deep.equal(afterWrites.values);
    });

    it("proves a slot cleared on a peer3 dev node as zero, and not with the proof of the block before", function () {
        const { afterWrites, afterClear } = peer3StorageProof;
        expect(afterWrites.values[1]).to.not.equal(ZeroHash);
        expect(afterClear.values[1]).to.equal(ZeroHash);
        expect(
            verifier.provenStorage(
                afterClear.stateRoot,
                peer3StorageProof.address,
                peer3StorageProof.slots,
                afterClear.proofNodes
            )
        ).to.deep.equal(afterClear.values);
        expect(() =>
            verifier.provenStorage(
                afterClear.stateRoot,
                peer3StorageProof.address,
                peer3StorageProof.slots,
                afterWrites.proofNodes
            )
        ).to.throw(StorageProofError, /holds no node with hash/);
    });
});
