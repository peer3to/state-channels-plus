import Block from "@/models/Block";
import { LoggerUtils } from "@/utils/LoggerUtils";
import {
    authoredConfirmedBlock,
    contractRejectedSignature,
    rejectedEncoding
} from "@test/fixtures/AcceptedSignersFixture";
import { expect } from "chai";
import { ethers } from "ethers";
import { describe, it } from "mocha";

// acceptedSignerAddresses names only the signers whose signatures the
// contracts accept (isContractAcceptedSignature); a rejected signature names
// no signer instead of throwing. allSignerAddresses keeps throwing on it. The
// rejected encodings are real signatures that ethers still recovers, so a
// rejected signer would show up if it were not skipped.

describe("Block accepted signers", function () {
    it("a high-s confirmation is skipped: the author and the other confirmer remain, allSignerAddresses still throws", async function () {
        const author = ethers.Wallet.createRandom();
        const honest = ethers.Wallet.createRandom();
        const rejected = ethers.Wallet.createRandom();
        const block = await authoredConfirmedBlock(author, [honest]);
        block.expandSignatures([
            await contractRejectedSignature(block, rejected, "high s")
        ]);

        expect([...block.acceptedSignerAddresses].sort()).to.deep.equal(
            [author.address, honest.address].sort()
        );
        expect(() => block.allSignerAddresses).to.throw(
            "signature is not accepted by the contracts"
        );
    });

    it("a confirmation with a v the contracts reject is skipped: only accepted signers remain, allSignerAddresses still throws", async function () {
        const author = ethers.Wallet.createRandom();
        const honest = ethers.Wallet.createRandom();
        const rejected = ethers.Wallet.createRandom();
        const block = await authoredConfirmedBlock(author, [honest]);
        block.expandSignatures([
            await contractRejectedSignature(block, rejected, "v of 0/1")
        ]);

        expect([...block.acceptedSignerAddresses].sort()).to.deep.equal(
            [author.address, honest.address].sort()
        );
        expect(() => block.allSignerAddresses).to.throw(
            "signature is not accepted by the contracts"
        );
    });

    it("a rejected author signature is skipped: only the confirmers remain, allSignerAddresses still throws", async function () {
        const author = ethers.Wallet.createRandom();
        const first = ethers.Wallet.createRandom();
        const second = ethers.Wallet.createRandom();
        const honest = await authoredConfirmedBlock(author, []);
        const block = Block.fromSignedBlock({
            encodedBlock: honest.encode(),
            signature: rejectedEncoding(honest.originalSignature, "high s")
        });
        block.expandSignatures([
            await block.sign(first),
            await block.sign(second)
        ]);

        expect([...block.acceptedSignerAddresses].sort()).to.deep.equal(
            [first.address, second.address].sort()
        );
        expect(() => block.allSignerAddresses).to.throw(
            "signature is not accepted by the contracts"
        );
    });

    it("an all-valid block → acceptedSignerAddresses equals allSignerAddresses", async function () {
        const author = ethers.Wallet.createRandom();
        const first = ethers.Wallet.createRandom();
        const second = ethers.Wallet.createRandom();
        const block = await authoredConfirmedBlock(author, [first, second]);

        expect([...block.acceptedSignerAddresses].sort()).to.deep.equal(
            [...block.allSignerAddresses].sort()
        );
        expect([...block.acceptedSignerAddresses].sort()).to.deep.equal(
            [author.address, first.address, second.address].sort()
        );
    });

    it("LoggerUtils.getBlockMetadata on a block with a rejected signature does not throw and lists only the accepted signers", async function () {
        const author = ethers.Wallet.createRandom();
        const honest = ethers.Wallet.createRandom();
        const rejected = ethers.Wallet.createRandom();
        const block = await authoredConfirmedBlock(author, [honest]);
        block.expandSignatures([
            await contractRejectedSignature(block, rejected, "high s")
        ]);

        const metadata = LoggerUtils.getBlockMetadata(block);

        expect([...metadata.allSigners].sort()).to.deep.equal(
            [author.address, honest.address].sort()
        );
        expect(metadata.allSigners).to.not.include(rejected.address);
        expect(metadata.author).to.equal(author.address);
    });
});
