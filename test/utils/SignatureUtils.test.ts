import { block as blockFactory } from "../factory";
import Block from "@/models/Block";
import { Signature } from "@/types/types";
import { SignatureUtils } from "@/utils/SignatureUtils";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { describe, it, before } from "mocha";

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

describe("SignatureUtils byte normalization", () => {
    it("normalizes equivalent hex and bytes without changing recovery", async () => {
        const [signer] = await ethers.getSigners();
        const message = ethers.id("signature normalization");
        const signature = await signer.signMessage(ethers.getBytes(message));
        const upper = "0x" + signature.slice(2).toUpperCase();
        expect(SignatureUtils.normalizeSignature(upper)).to.equal(
            signature.toLowerCase()
        );
        expect(
            SignatureUtils.normalizeSignature(ethers.getBytes(signature))
        ).to.equal(signature.toLowerCase());
        expect(
            ethers.verifyMessage(
                ethers.getBytes(message),
                SignatureUtils.normalizeSignature(upper)
            )
        ).to.equal(signer.address);
    });

    it("does not repair malformed hex or reinterpret a recovery byte", () => {
        const malformed = "0xGG";
        expect(SignatureUtils.normalizeSignature(malformed)).to.equal(
            malformed
        );
        const invalidRecovery = "0x" + "ab".repeat(64) + "ff";
        expect(SignatureUtils.normalizeSignature(invalidRecovery)).to.equal(
            invalidRecovery
        );
    });

    it("keeps compact signature bytes compact", async () => {
        const [signer] = await ethers.getSigners();
        const signature = ethers.Signature.from(
            await signer.signMessage("compact representation")
        );
        expect(
            SignatureUtils.normalizeSignature(signature.compactSerialized)
        ).to.equal(signature.compactSerialized.toLowerCase());
        expect(
            ethers.getBytes(
                SignatureUtils.normalizeSignature(
                    signature.compactSerialized
                ) as string
            ).length
        ).to.equal(64);
    });
});
