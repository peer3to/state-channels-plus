import { expect } from "chai";
import { describe, it, before } from "mocha";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import Block from "@/models/Block";
import { SignatureUtils } from "@/utils/SignatureUtils";
import { block as blockFactory } from "../factory";
import { Signature } from "@/types/types";

describe("SignatureUtils.getSignerAddress", () => {
    let signer: HardhatEthersSigner;

    before(async () => {
        [signer] = await ethers.getSigners();
    });

    it("recovers the signer of a message", async () => {
        const msg = ethers.hexlify(ethers.randomBytes(48));
        const sig = (await SignatureUtils.signMsg(msg, signer)) as Signature;
        expect(SignatureUtils.getSignerAddress(msg, sig)).to.equal(
            signer.address
        );
    });

    it("agrees with Block.signatureToAddress for a block (same recovery key space)", async () => {
        const block = Block.fromSignedBlock(
            await blockFactory().signBlock(signer)
        );
        const sig = block.originalSignature;
        // Block recovers over getBytes(hash); SignatureUtils over
        // getBytes(keccak256(encode)) — identical digest, so both agree.
        expect(SignatureUtils.getSignerAddress(block.encode(), sig)).to.equal(
            block.signatureToAddress(sig)
        );
        expect(block.signatureToAddress(sig)).to.equal(signer.address);
    });
});
