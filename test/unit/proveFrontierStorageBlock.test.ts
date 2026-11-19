import StorageProofError from "@/evm/p2pRuntime/rpcNodes/lightClient/proof/StorageProofError";
import proveFrontierStorageBlock from "@/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/proveFrontierStorageBlock";
import { peer3PushedBlocks } from "@test/fixtures/lightClient/peer3PushedBlocks";
import { expect } from "chai";
import { toBeHex, ZeroHash } from "ethers";

const { address, pushes } = peer3PushedBlocks;
const [oneWrite, twoWrites, cleared] = pushes;
const SLOT_ONE = toBeHex(1, 32);
const SLOT_TWO = toBeHex(2, 32);

describe("proveFrontierStorageBlock", function () {
    it("proves the write of a pushed block under the block's own header", function () {
        const proven = proveFrontierStorageBlock(oneWrite.block, address);
        expect(proven.writes).to.deep.equal([
            { slot: SLOT_ONE, value: toBeHex(0xaaaa, 32) }
        ]);
        expect(proven.header.hash).to.equal(oneWrite.substrateBlockHash);
        expect(proven.ethereumBlockHash).to.equal(oneWrite.ethereumBlockHash);
    });

    it("proves every write of a block, also of a slot no pushed log names", function () {
        expect(twoWrites.block.logs.length).to.equal(1);
        expect(twoWrites.block.logs[0].topics).to.deep.equal([SLOT_ONE]);
        const proven = proveFrontierStorageBlock(twoWrites.block, address);
        expect(proven.writes).to.have.deep.members([
            { slot: SLOT_ONE, value: toBeHex(0xcccc, 32) },
            { slot: SLOT_TWO, value: toBeHex(0xdddd, 32) }
        ]);
    });

    it("proves a slot pushed as cleared to zero", function () {
        expect(cleared.block.writes).to.deep.equal([
            { slot: SLOT_ONE, value: null }
        ]);
        const proven = proveFrontierStorageBlock(cleared.block, address);
        expect(proven.writes).to.deep.equal([
            { slot: SLOT_ONE, value: ZeroHash }
        ]);
    });

    it("accepts a block that carries a log and no write", function () {
        const proven = proveFrontierStorageBlock(
            { ...oneWrite.block, writes: [], proofNodes: [] },
            address
        );
        expect(proven.writes).to.deep.equal([]);
        expect(proven.ethereumBlockHash).to.equal(oneWrite.ethereumBlockHash);
    });

    it("throws when a pushed value differs from the proven one", function () {
        const block = {
            ...oneWrite.block,
            writes: [{ slot: SLOT_ONE, value: toBeHex(0xaaab, 32) }]
        };
        expect(() => proveFrontierStorageBlock(block, address)).to.throw(
            StorageProofError,
            /was pushed as .*aaab and is proven as .*aaaa/
        );
    });

    it("throws when a stored slot is pushed as cleared", function () {
        const block = {
            ...oneWrite.block,
            writes: [{ slot: SLOT_ONE, value: null }]
        };
        expect(() => proveFrontierStorageBlock(block, address)).to.throw(
            StorageProofError,
            /was pushed as 0x0{64} and is proven as .*aaaa/
        );
    });

    it("throws when a cleared slot is pushed with a value", function () {
        const block = {
            ...cleared.block,
            writes: [{ slot: SLOT_ONE, value: toBeHex(0xcccc, 32) }]
        };
        expect(() => proveFrontierStorageBlock(block, address)).to.throw(
            StorageProofError,
            /was pushed as .*cccc and is proven as 0x0{64}/
        );
    });

    it("throws when the proof is left out", function () {
        const block = { ...oneWrite.block, proofNodes: [] };
        expect(() => proveFrontierStorageBlock(block, address)).to.throw(
            StorageProofError,
            /holds no node with hash/
        );
    });

    it("throws when the block carries the header of another block", function () {
        const block = { ...oneWrite.block, header: twoWrites.block.header };
        expect(() => proveFrontierStorageBlock(block, address)).to.throw(
            StorageProofError,
            /A pushed log is of block/
        );
    });

    it("throws when the proof belongs to another block's state root", function () {
        const block = {
            ...cleared.block,
            proofNodes: oneWrite.block.proofNodes
        };
        expect(() => proveFrontierStorageBlock(block, address)).to.throw(
            StorageProofError,
            /holds no node with hash/
        );
    });

    it("throws when a pushed log is of another Ethereum block", function () {
        const block = {
            ...oneWrite.block,
            logs: [
                {
                    ...oneWrite.block.logs[0],
                    blockHash: twoWrites.ethereumBlockHash
                }
            ]
        };
        expect(() => proveFrontierStorageBlock(block, address)).to.throw(
            StorageProofError,
            /A pushed log is of block/
        );
    });

    it("throws a StorageProofError when a pushed slot is not 32 bytes long", function () {
        const block = {
            ...oneWrite.block,
            writes: [{ ...oneWrite.block.writes[0], slot: "0x01" }]
        };
        expect(() => proveFrontierStorageBlock(block, address)).to.throw(
            StorageProofError,
            /malformed/
        );
    });

    it("throws a StorageProofError when a pushed value is not 32 bytes long", function () {
        const block = {
            ...oneWrite.block,
            writes: [{ ...oneWrite.block.writes[0], value: "0xaaaa" }]
        };
        expect(() => proveFrontierStorageBlock(block, address)).to.throw(
            StorageProofError,
            /malformed/
        );
    });

    it("throws a StorageProofError when a proof node is not hex", function () {
        const block = {
            ...oneWrite.block,
            proofNodes: [...oneWrite.block.proofNodes, "not hex"]
        };
        expect(() => proveFrontierStorageBlock(block, address)).to.throw(
            StorageProofError,
            /malformed/
        );
    });

    it("throws a StorageProofError when a header field is not hex", function () {
        const block = {
            ...oneWrite.block,
            header: { ...oneWrite.block.header, extrinsicsRoot: "0xzz" }
        };
        expect(() => proveFrontierStorageBlock(block, address)).to.throw(
            StorageProofError,
            /malformed/
        );
    });

    it("throws a StorageProofError when a pushed log has no block hash", function () {
        const { blockHash: _left, ...logWithoutHash } = oneWrite.block.logs[0];
        const block = { ...oneWrite.block, logs: [logWithoutHash] };
        expect(() => proveFrontierStorageBlock(block, address)).to.throw(
            StorageProofError,
            /malformed/
        );
    });

    it("throws a StorageProofError when the pushed block is not an object", function () {
        for (const pushed of [null, "block", [oneWrite.block]])
            expect(() => proveFrontierStorageBlock(pushed, address)).to.throw(
                StorageProofError,
                /malformed/
            );
    });
});
