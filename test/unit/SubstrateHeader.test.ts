import StorageProofError from "@/evm/p2pRuntime/rpcNodes/lightClient/proof/StorageProofError";
import { encodeCompact } from "@/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/ScaleReader";
import SubstrateHeader from "@/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/SubstrateHeader";
import {
    headerWithDigestLogs,
    peer3PushedBlocks
} from "@test/fixtures/lightClient/peer3PushedBlocks";
import { expect } from "chai";
import { concat, hexlify, toBeHex } from "ethers";

const { pushes } = peer3PushedBlocks;
const [first] = pushes;
const header = first.block.header;
const frontierLog = header.digest.logs.find((log) =>
    log.startsWith("0x0466726f6e")
)!;
const otherLogs = header.digest.logs.filter((log) => log !== frontierLog);

describe("SubstrateHeader", function () {
    it("hashes each recorded header to the block hash its node reports", function () {
        expect(pushes.length).to.equal(3);
        for (const push of pushes)
            expect(new SubstrateHeader(push.block.header).hash).to.equal(
                push.substrateBlockHash
            );
    });

    it("hashes to another value when the state root is changed", function () {
        const changed = new SubstrateHeader({
            ...header,
            stateRoot: pushes[1].block.header.stateRoot
        });
        expect(changed.hash).to.not.equal(first.substrateBlockHash);
    });

    it("reads the number and the state root of the header", function () {
        const read = new SubstrateHeader(header);
        expect(read.number).to.equal(4);
        expect(read.stateRoot).to.equal(header.stateRoot);
    });

    it("reads the Ethereum block hash Frontier wrote into each recorded digest", function () {
        for (const push of pushes)
            expect(
                new SubstrateHeader(push.block.header).ethereumBlockHash()
            ).to.equal(push.ethereumBlockHash);
    });

    it("throws when the digest holds no Frontier log", function () {
        expect(otherLogs.length).to.equal(header.digest.logs.length - 1);
        expect(() =>
            headerWithDigestLogs(header, otherLogs).ethereumBlockHash()
        ).to.throw(StorageProofError, /holds 0 Frontier logs/);
    });

    it("throws when the digest holds two Frontier logs", function () {
        expect(() =>
            headerWithDigestLogs(header, [
                ...header.digest.logs,
                frontierLog
            ]).ethereumBlockHash()
        ).to.throw(StorageProofError, /holds 2 Frontier logs/);
    });

    it("throws when the Frontier log holds a whole block and no hash", function () {
        // a consensus log of engine "fron" whose one data byte is post-log variant 2
        const blockLog = "0x0466726f6e0402";
        expect(() =>
            headerWithDigestLogs(header, [
                ...otherLogs,
                blockLog
            ]).ethereumBlockHash()
        ).to.throw(StorageProofError, /holds no block hash/);
    });

    it("throws when the Frontier log ends before its hash", function () {
        // variant 1 followed by one byte where 32 are due
        const shortLog = "0x0466726f6e080100";
        expect(() =>
            headerWithDigestLogs(header, [
                ...otherLogs,
                shortLog
            ]).ethereumBlockHash()
        ).to.throw(StorageProofError, /header digest log ends early/);
    });

    it("reads the Ethereum block hash of a Frontier log that holds the hash alone", function () {
        const ethereumBlockHash = toBeHex(0xabcdef, 32);
        // engine "fron", 33 data bytes: post-log variant 3 (`BlockHash`) and the hash
        const blockHashLog = concat(["0x0466726f6e8403", ethereumBlockHash]);
        expect(
            headerWithDigestLogs(header, [
                ...otherLogs,
                blockHashLog
            ]).ethereumBlockHash()
        ).to.equal(ethereumBlockHash);
    });

    it("throws when a hash of the header is not 32 bytes long", function () {
        expect(
            () =>
                new SubstrateHeader({
                    ...header,
                    stateRoot: header.stateRoot.slice(0, -2)
                })
        ).to.throw(StorageProofError, /not 32 bytes long/);
    });

    it("encodes numbers as SCALE compact integers on both sides of each size boundary", function () {
        const encoded = (value: number) => hexlify(encodeCompact(value));
        expect(encoded(0)).to.equal("0x00");
        expect(encoded(63)).to.equal("0xfc");
        expect(encoded(64)).to.equal("0x0101");
        expect(encoded(16383)).to.equal("0xfdff");
        expect(encoded(16384)).to.equal("0x02000100");
        expect(encoded(2 ** 30 - 1)).to.equal("0xfeffffff");
        expect(encoded(2 ** 30)).to.equal("0x0300000040");
        expect(encoded(2 ** 32 - 1)).to.equal("0x03ffffffff");
    });

    it("throws when the block number is empty hex or not hex", function () {
        for (const number of ["0x", "7"])
            expect(() => new SubstrateHeader({ ...header, number })).to.throw(
                StorageProofError,
                /is no hex u32/
            );
    });

    it("throws when the block number is wider than 32 bits, and reads the widest one", function () {
        expect(
            () => new SubstrateHeader({ ...header, number: "0x100000000" })
        ).to.throw(StorageProofError, /is no hex u32/);
        expect(
            new SubstrateHeader({ ...header, number: "0xffffffff" }).number
        ).to.equal(2 ** 32 - 1);
    });
});
