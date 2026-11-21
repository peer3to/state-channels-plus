import StorageProofError from "@/evm/p2pRuntime/rpcNodes/lightClient/proof/StorageProofError";
import FrontierEthereumHeader from "@/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/FrontierEthereumHeader";
import { CURRENT_ETHEREUM_BLOCK_KEY } from "@/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/frontierStateKeys";
import SubstrateTrieProof from "@/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/SubstrateTrieProof";
import { peer3EthereumBlock } from "@test/fixtures/lightClient/peer3EthereumBlock";
import { expect } from "chai";
import { concat, dataSlice, getBytes, hexlify } from "ethers";

const {
    stateRoot,
    ethereumBlockHash,
    number,
    timestampSeconds,
    miner,
    gasLimit,
    difficulty,
    encodedBlock,
    proofNodes
} = peer3EthereumBlock;

/** Where the fixed-width part of an encoded header ends and its extra data starts. */
const EXTRA_DATA_OFFSET = 572;
/** Where the gas limit starts in an encoded header. */
const GAS_LIMIT_OFFSET = 500;

describe("FrontierEthereumHeader", function () {
    it("hashes a recorded header to the Ethereum block hash its node reports", function () {
        const header = new FrontierEthereumHeader(getBytes(encodedBlock));

        expect(header.hash).to.equal(ethereumBlockHash);
        expect(() => header.assertHash(ethereumBlockHash)).to.not.throw();
        expect(() =>
            header.assertHash(ethereumBlockHash.toUpperCase().replace("X", "x"))
        ).to.not.throw();
    });

    it("reads the block values the node reports for the block", function () {
        const header = new FrontierEthereumHeader(getBytes(encodedBlock));

        expect(header.number).to.equal(number);
        expect(header.gasLimit).to.equal(gasLimit);
        expect(header.beneficiary).to.equal(miner);
        expect(header.difficulty).to.equal(difficulty);
        expect(header.gasLimit).to.not.equal(0n);
    });

    it("reads the timestamp in milliseconds, which the node reports in whole seconds", function () {
        const header = new FrontierEthereumHeader(getBytes(encodedBlock));

        expect(header.timestampMs / 1000n).to.equal(timestampSeconds);
        expect(header.timestampMs > timestampSeconds).to.equal(true);
    });

    it("reads the recorded block from its proof under the block's state root", function () {
        const proven = new SubstrateTrieProof(proofNodes).read(
            stateRoot,
            CURRENT_ETHEREUM_BLOCK_KEY
        );

        expect(proven).to.not.equal(null);
        expect(hexlify(proven!)).to.equal(encodedBlock);
        expect(new FrontierEthereumHeader(proven!).hash).to.equal(
            ethereumBlockHash
        );
    });

    it("throws when the header is not of the named Ethereum block", function () {
        const header = new FrontierEthereumHeader(getBytes(encodedBlock));
        const other = "0x" + "11".repeat(32);

        expect(() => header.assertHash(other)).to.throw(
            StorageProofError,
            /not the header's block/
        );
    });

    it("hashes to another value when a block value is changed", function () {
        const changed = getBytes(encodedBlock);
        changed[GAS_LIMIT_OFFSET] ^= 1;
        const header = new FrontierEthereumHeader(changed);

        expect(header.gasLimit).to.not.equal(gasLimit);
        expect(header.hash).to.not.equal(ethereumBlockHash);
        expect(() => header.assertHash(ethereumBlockHash)).to.throw(
            StorageProofError
        );
    });

    it("reads the fields that follow a header's extra data", function () {
        // the recorded header has no extra data
        expect(
            dataSlice(encodedBlock, EXTRA_DATA_OFFSET, EXTRA_DATA_OFFSET + 1)
        ).to.equal("0x00");
        const mixHash = "0x" + "22".repeat(32);
        const withExtraData = concat([
            dataSlice(encodedBlock, 0, EXTRA_DATA_OFFSET),
            // a SCALE vector of two bytes
            "0x08abcd",
            mixHash,
            "0x0000000000000000"
        ]);
        const header = new FrontierEthereumHeader(getBytes(withExtraData));

        expect(header.mixHash).to.equal(mixHash);
        expect(header.number).to.equal(number);
        expect(header.hash).to.not.equal(ethereumBlockHash);
    });

    it("throws when the block ends inside its header", function () {
        expect(
            () =>
                new FrontierEthereumHeader(
                    getBytes(dataSlice(encodedBlock, 0, EXTRA_DATA_OFFSET))
                )
        ).to.throw(StorageProofError, /ends early/);
        expect(() => new FrontierEthereumHeader(new Uint8Array())).to.throw(
            StorageProofError,
            /ends early/
        );
    });
});
