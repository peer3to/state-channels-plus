import { expect } from "chai";
import { describe, it, beforeEach } from "mocha";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import Block from "@/models/Block";
import { BlockStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { block as blockFactory } from "../factory";
import { Timestamp, Signature } from "@/types/types";

describe("Block Model", () => {
    let blockStruct: BlockStruct;
    let block: Block;
    let signer: HardhatEthersSigner;
    let signers: HardhatEthersSigner[];

    before(async () => {
        signers = await ethers.getSigners();
    });

    beforeEach(async () => {
        block = blockFactory();
        blockStruct = block.blockStruct;
        signer = signers[0];
    });

    describe("Static factory methods", () => {
        it("should create Block from BlockStruct", () => {
            const blockInstance = Block.fromSignedBlock(block.signedBlock);
            expect(blockInstance).to.be.instanceOf(Block);
            expect(blockInstance.blockStruct).to.deep.equal(blockStruct);
        });

        it("should create Block from BlockConfirmation", () => {
            const blockConfirmation = block.blockConfirmationStruct;
            const decoded = Block.fromBlockConfirmation(blockConfirmation);
            expect(decoded).to.be.instanceOf(Block);
            expect(decoded.blockStruct).to.deep.equal(blockStruct);
        });
    });

    describe("Hash computation", () => {
        it("should compute hash correctly", () => {
            const hash = block.hash;
            const expectedHash = ethers.keccak256(block.encode());
            expect(hash).to.equal(expectedHash);
        });

        it("should have consistent hash for same data", () => {
            const block1 = Block.fromSignedBlock(block.signedBlock);
            const block2 = Block.fromSignedBlock(block.signedBlock);
            expect(block1.hash).to.equal(block2.hash);
        });
    });

    describe("Property getters", () => {
        it("should return correct coordinates", () => {
            const coordinates = block.coordinates;
            expect(coordinates.forkId).to.equal(
                blockStruct.transaction.header.forkId
            );
            expect(coordinates.height).to.equal(
                Number(blockStruct.transaction.header.transactionCnt)
            );
        });

        it("should return correct height", () => {
            expect(block.height).to.equal(
                Number(blockStruct.transaction.header.transactionCnt)
            );
        });

        it("should return correct forkId", () => {
            expect(block.forkId).to.equal(
                blockStruct.transaction.header.forkId
            );
        });

        it("should return correct timestamp", () => {
            expect(block.timestamp).to.equal(
                Number(blockStruct.transaction.header.timestamp)
            );
        });

        it("should return correct author", () => {
            expect(block.author).to.equal(
                blockStruct.transaction.header.participant
            );
        });

        it("should return correct channelId", () => {
            expect(block.channelId).to.equal(
                blockStruct.transaction.header.channelId
            );
        });

        it("should return correct previousBlockHash", () => {
            expect(block.previousBlockHash).to.equal(
                blockStruct.previousBlockHash
            );
        });

        it("should return correct stateSnapshotHash", () => {
            expect(block.stateSnapshotHash).to.equal(
                blockStruct.stateSnapshotHash
            );
        });

        it("should return correct transaction", () => {
            expect(block.tx).to.deep.equal(blockStruct.transaction);
        });
    });

    describe("Block equality", () => {
        it("should identify equal blocks", () => {
            const block1 = block;
            const block2 = block;
            expect(block1.equals(block2)).to.be.true;
        });

        it("should identify different blocks", () => {
            const block1 = Block.fromSignedBlock(block.signedBlock);
            const differentBlock = blockFactory({
                previousBlockHash: ethers.hexlify(ethers.randomBytes(32))
            });
            expect(block1.equals(differentBlock)).to.be.false;
        });
    });

    describe("Signature operations", () => {
        it("should get signer address from signature", () => {
            const message = ethers.getBytes(block.hash);
            const signature = signer.signMessage(message);

            return signature.then((sig) => {
                const recoveredAddress = block.signatureToAddress(sig);
                expect(recoveredAddress).to.equal(signer.address);
            });
        });

        it("should find participant signature", async () => {
            const testBlock = blockFactory();
            const message = ethers.getBytes(testBlock.hash);
            const signature = await signer.signMessage(message);

            const signedBlockStruct = {
                encodedBlock: testBlock.encode(),
                signature: signature
            };
            const realSignedBlock = Block.fromSignedBlock(signedBlockStruct);

            const _signature = realSignedBlock.findSignature(signer.address);

            expect(_signature).to.equal(signature);
        });

        it("should handle participant who didn't sign", async () => {
            // Create a block signed by the first signer
            const testBlock = blockFactory();

            const signedBlockStruct = await testBlock.signBlock(signer);
            const realSignedBlock = Block.fromSignedBlock(signedBlockStruct);

            // Try to find signature for a different signer who didn't sign this block
            const nonSigner = signers[1];
            const signature = realSignedBlock.findSignature(nonSigner.address);

            expect(signature).to.be.undefined;
        });

        it("should sign block", async () => {
            const signature = await block.sign(signer);

            // Verify signature
            const recoveredAddress = block.signatureToAddress(signature);
            expect(recoveredAddress).to.equal(signer.address);
        });

        it("should create signed block", async () => {
            const signedBlock = await block.signBlock(signer);

            expect(signedBlock.encodedBlock).to.equal(block.encode());

            // Verify signature
            const recoveredAddress = block.signatureToAddress(
                signedBlock.signature as Signature
            );
            expect(recoveredAddress).to.equal(signer.address);
        });
    });

    describe("Signature management", () => {
        it("should return signer address from original signature", async () => {
            const testBlock = blockFactory();

            const signedBlockStruct = await testBlock.signBlock(signer);
            const realSignedBlock = Block.fromSignedBlock(signedBlockStruct);

            const signerAddr = realSignedBlock.signerAddress;

            expect(signerAddr).to.equal(signer.address);
        });

        it("should return confirmation signatures", () => {
            const confirmationSigs = block.confirmationSignatures;
            expect(confirmationSigs).to.be.instanceOf(Set);
        });

        it("should return all signatures including original and confirmations", () => {
            const allSigs = block.allSignatures;
            expect(allSigs).to.be.instanceOf(Set);
            expect(allSigs.has(block.originalSignature)).to.be.true;
        });

        it("should return confirmation signer addresses", () => {
            const confirmationAddrs = block.confirmationSignerAddresses;
            expect(confirmationAddrs).to.be.instanceOf(Set);
        });

        it("should return all signer addresses", async () => {
            const testBlock = blockFactory();

            const signedBlockStruct = await testBlock.signBlock(signer);
            const realSignedBlock = Block.fromSignedBlock(signedBlockStruct);

            const allAddrs = realSignedBlock.allSignerAddresses;
            expect(allAddrs).to.be.instanceOf(Set);
            expect(allAddrs.has(realSignedBlock.signerAddress)).to.be.true;
        });

        it("should expand signatures with new signatures array", async () => {
            const signer2 = signers[1];
            const signature2 = await signer2.signMessage(
                ethers.getBytes(block.hash)
            );

            const originalConfirmationCount = block.confirmationSignatures.size;
            block.expandSignatures([signature2]);

            expect(block.confirmationSignatures.size).to.equal(
                originalConfirmationCount + 1
            );
            expect(block.confirmationSignatures.has(signature2)).to.be.true;
        });

        it("should grow cached signer addresses when expanding signatures", async () => {
            const signer2 = signers[1];
            const signature2 = await signer2.signMessage(
                ethers.getBytes(block.hash)
            );

            expect(block.didSign(signer2.address)).to.equal(false);
            block.expandSignatures([signature2]);

            expect(block.didSign(signer2.address)).to.equal(true);
        });

        it("should expand signatures with new signatures Set", async () => {
            const signer2 = signers[1];
            const signer3 = signers[2];
            const signature2 = await signer2.signMessage(
                ethers.getBytes(block.hash)
            );
            const signature3 = await signer3.signMessage(
                ethers.getBytes(block.hash)
            );

            const originalConfirmationCount = block.confirmationSignatures.size;
            const newSignatures = new Set([signature2, signature3]);
            block.expandSignatures(newSignatures);

            expect(block.confirmationSignatures.size).to.equal(
                originalConfirmationCount + 2
            );
            expect(block.confirmationSignatures.has(signature2)).to.be.true;
            expect(block.confirmationSignatures.has(signature3)).to.be.true;
        });

        it("should not duplicate signatures when expanding", async () => {
            const signer2 = signers[1];
            const signature2 = await signer2.signMessage(
                ethers.getBytes(block.hash)
            );

            block.expandSignatures([signature2]);
            const countAfterFirst = block.confirmationSignatures.size;

            // Add same signature again
            block.expandSignatures([signature2]);

            expect(block.confirmationSignatures.size).to.equal(countAfterFirst);
        });
    });

    describe("Block confirmation struct", () => {
        it("should return correct block confirmation struct", async () => {
            const signer2 = signers[1];
            const signature2 = await signer2.signMessage(
                ethers.getBytes(block.hash)
            );
            block.expandSignatures([signature2]);

            const blockConfirmation = block.blockConfirmationStruct;

            expect(blockConfirmation.signedBlock).to.deep.equal(
                block.signedBlock
            );

            expect(blockConfirmation.signatures).to.include(signature2);
        });
    });

    describe("Timestamp utilities", () => {
        it("should return block timestamp when participant has signed", async () => {
            const testBlock = blockFactory();
            const signature = await signer.signMessage(
                ethers.getBytes(testBlock.hash)
            );
            const signedBlockStruct = {
                encodedBlock: testBlock.encode(),
                signature: signature
            };
            const realSignedBlock = Block.fromSignedBlock(signedBlockStruct);

            const participant = realSignedBlock.signerAddress;
            const relevantTimestamp =
                realSignedBlock.getRelevantTimestamp(participant);

            expect(relevantTimestamp).to.equal(realSignedBlock.timestamp);
        });

        it("should return onChainTimestamp when participant has not signed and onChainTimestamp is set", async () => {
            const testBlock = blockFactory();
            const signedBlockStruct = await testBlock.signBlock(signer);
            const realSignedBlock = Block.fromSignedBlock(signedBlockStruct);

            const nonSignerAddress = signers[1].address;
            const onChainTime = realSignedBlock.timestamp + 1000;
            realSignedBlock.onChainTimestamp = onChainTime;

            const relevantTimestamp =
                realSignedBlock.getRelevantTimestamp(nonSignerAddress);

            expect(relevantTimestamp).to.equal(
                Math.max(onChainTime, realSignedBlock.timestamp)
            );
        });

        it("should return block timestamp when participant has not signed and onChainTimestamp is not set", async () => {
            const testBlock = blockFactory();
            const signedBlockStruct = await testBlock.signBlock(signer);
            const realSignedBlock = Block.fromSignedBlock(signedBlockStruct);

            const nonSignerAddress = signers[1].address;
            // Ensure onChainTimestamp is undefined
            realSignedBlock.onChainTimestamp = undefined as any;

            const relevantTimestamp =
                realSignedBlock.getRelevantTimestamp(nonSignerAddress);

            expect(relevantTimestamp).to.equal(realSignedBlock.timestamp);
        });

        it("should return max of onChainTimestamp and block timestamp when both are set", async () => {
            const testBlock = blockFactory();

            const signedBlockStruct = await testBlock.signBlock(signer);
            const realSignedBlock = Block.fromSignedBlock(signedBlockStruct);

            const nonSignerAddress = signers[1].address;
            const onChainTime = realSignedBlock.timestamp - 500; // Earlier than block timestamp
            realSignedBlock.onChainTimestamp = onChainTime;

            const relevantTimestamp =
                realSignedBlock.getRelevantTimestamp(nonSignerAddress);

            expect(relevantTimestamp).to.equal(realSignedBlock.timestamp);
        });
    });

    describe("Immutability", () => {
        it("should not allow modification of underlying data", () => {
            const originalStruct = block.blockStruct;
            const retrievedStruct = block.blockStruct;

            // Modify the retrieved struct
            retrievedStruct.previousBlockHash = ethers.hexlify(
                ethers.randomBytes(32)
            );

            // Original should remain unchanged
            expect(block.blockStruct).to.deep.equal(originalStruct);
        });
    });

    describe("On-chain timestamp", () => {
        it("should have undefined onChainTimestamp by default", () => {
            expect(block.onChainTimestamp).to.be.undefined;
        });

        it("should set and get onChainTimestamp", () => {
            const onChainTimestamp: Timestamp = 1234567890;
            block.onChainTimestamp = onChainTimestamp;

            expect(block.onChainTimestamp).to.equal(onChainTimestamp);
        });

        it("should not affect encoding when onChainTimestamp is set", () => {
            const originalEncoded = block.encode();

            block.onChainTimestamp = 1234567890;
            const encodedWithTimestamp = block.encode();

            expect(encodedWithTimestamp).to.equal(originalEncoded);
        });

        it("should not change hash when onChainTimestamp is set", () => {
            const originalHash = block.hash;
            const onChainTimestamp: Timestamp = 1234567890;

            block.onChainTimestamp = onChainTimestamp;

            expect(block.hash).to.equal(originalHash);
            expect(block.onChainTimestamp).to.equal(onChainTimestamp);
        });
        it("should consider blocks equal regardless of onChainTimestamp", () => {
            const block1 = block;
            const block2 = block;

            // Set different onChainTimestamps
            block1.onChainTimestamp = 1234567890;
            block2.onChainTimestamp = 9876543210;

            // They should still be equal because onChainTimestamp doesn't affect encoding
            expect(block1.equals(block2)).to.be.true;
        });
    });
});
