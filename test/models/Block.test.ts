import { expect } from "chai";
import { describe, it, beforeEach } from "mocha";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import Block from "@/models/Block";
import { BlockStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { Codec, Type } from "@/utils";
import { block as blockFactory } from "../factory";
import { Timestamp } from "@/types/types";

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
        blockStruct = block.toStruct();
        signer = signers[0];
    });

    describe("Static factory methods", () => {
        it("should create Block from BlockStruct", () => {
            const blockInstance = Block.from(blockStruct);
            expect(blockInstance).to.be.instanceOf(Block);
            expect(blockInstance.toStruct()).to.deep.equal(blockStruct);
        });

        it("should create Block from encoded bytes", () => {
            const encoded = Codec.encode(blockStruct, Type.Block);
            const decoded = Block.decode(encoded);
            expect(decoded).to.be.instanceOf(Block);
            expect(decoded.toStruct()).to.deep.equal(blockStruct);
        });
    });

    describe("Serialization", () => {
        it("should convert back to struct correctly", () => {
            const struct = block.toStruct();
            expect(struct).to.deep.equal(blockStruct);
        });

        it("should round-trip encode/decode correctly", () => {
            const encoded = block.encode();
            const decoded = Block.decode(encoded);
            expect(decoded.toStruct()).to.deep.equal(block.toStruct());
        });
    });

    describe("Hash computation", () => {
        it("should compute hash correctly", () => {
            const hash = block.hash;
            const expectedHash = ethers.keccak256(block.encode());
            expect(hash).to.equal(expectedHash);
        });

        it("should have consistent hash for same data", () => {
            const block1 = Block.from(blockStruct);
            const block2 = Block.from(blockStruct);
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
            expect(block.transaction).to.deep.equal(blockStruct.transaction);
        });
    });

    describe("Block equality", () => {
        it("should identify equal blocks", () => {
            const block1 = Block.from(blockStruct);
            const block2 = Block.from(blockStruct);
            expect(block1.equals(block2)).to.be.true;
        });

        it("should identify different blocks", () => {
            const block1 = Block.from(blockStruct);
            const differentStruct = blockFactory({
                previousBlockHash: ethers.hexlify(ethers.randomBytes(32))
            });
            const block2 = Block.from(differentStruct);
            expect(block1.equals(block2)).to.be.false;
        });
    });

    describe("Signature operations", () => {
        it("should get signer address from signature", () => {
            const message = ethers.getBytes(block.hash);
            const signature = signer.signMessage(message);

            return signature.then((sig) => {
                const recoveredAddress = block.getSignerAddress(sig);
                expect(recoveredAddress).to.equal(signer.address);
            });
        });

        it("should get signers set from multiple signatures", async () => {
            const message = ethers.getBytes(block.hash);

            const sig1 = await signers[1].signMessage(message);
            const sig2 = await signers[2].signMessage(message);

            const signersSet = block.getSignersSet([sig1, sig2]);
            expect(signersSet.size).to.equal(2);
            expect(signersSet.has(signers[1].address)).to.be.true;
            expect(signersSet.has(signers[2].address)).to.be.true;
        });

        it("should find participant signature", async () => {
            const message = ethers.getBytes(block.hash);
            const signature = await signer.signMessage(message);

            const result = block.getParticipantSignature(signer.address, [
                signature
            ]);

            expect(result.didSign).to.be.true;
            expect(result.signature).to.equal(signature);
        });

        it("should handle participant who didn't sign", async () => {
            const nonSigner = signers[1];
            const result = block.getParticipantSignature(nonSigner.address, []);

            expect(result.didSign).to.be.false;
            expect(result.signature).to.be.undefined;
        });

        it("should sign block", async () => {
            const signature = await block.sign(signer);

            // Verify signature
            const recoveredAddress = block.getSignerAddress(signature);
            expect(recoveredAddress).to.equal(signer.address);
        });

        it("should create signed block", async () => {
            const signedBlock = await block.signedBlock(signer);
            expect(signedBlock).to.have.property("encodedBlock");
            expect(signedBlock).to.have.property("signature");
            expect(signedBlock.encodedBlock).to.equal(block.encode());

            // Verify signature
            const recoveredAddress = block.getSignerAddress(
                signedBlock.signature
            );
            expect(recoveredAddress).to.equal(signer.address);
        });
    });

    describe("Data integrity", () => {
        it("should maintain data integrity through transformations", () => {
            const original = block.toStruct();
            const encoded = block.encode();
            const decoded = Block.decode(encoded);
            const final = decoded.toStruct();

            expect(final).to.deep.equal(original);
        });
    });

    describe("Immutability", () => {
        it("should not allow modification of underlying data", () => {
            const originalStruct = block.toStruct();
            const retrievedStruct = block.toStruct();

            // Modify the retrieved struct
            retrievedStruct.previousBlockHash = ethers.hexlify(
                ethers.randomBytes(32)
            );

            // Original should remain unchanged
            expect(block.toStruct()).to.deep.equal(originalStruct);
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
            const block1 = Block.from(blockStruct);
            const block2 = Block.from(blockStruct);

            // Set different onChainTimestamps
            block1.onChainTimestamp = 1234567890;
            block2.onChainTimestamp = 9876543210;

            // They should still be equal because onChainTimestamp doesn't affect encoding
            expect(block1.equals(block2)).to.be.true;
        });
    });
});
