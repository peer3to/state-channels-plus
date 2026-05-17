import { expect } from "chai";
import { describe, it, beforeEach } from "mocha";
import { ethers } from "hardhat";
import { QueueStorage } from "@/storage/QueueStorage";
import {
    BlockConfirmationStruct,
    SignedBlockStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { ForkId, BlockHeight } from "@/types/types";
import * as factory from "../factory";
import { Block } from "@/models";
import Storage from "@/storage";

const sig = () => ethers.hexlify(ethers.randomBytes(65));

describe("QueueStorage", () => {
    let storage: QueueStorage;
    let mockSignedBlock: SignedBlockStruct;
    let mockBlockConfirmation: BlockConfirmationStruct;
    let mockBlock: Block;
    let mockForkId: ForkId;
    let mockHeight: BlockHeight;

    beforeEach(() => {
        storage = new QueueStorage();
        mockSignedBlock = factory.signedBlock();
        mockBlockConfirmation = factory.blockConfirmation({
            signedBlock: mockSignedBlock
        });

        mockBlock = Block.fromSignedBlock(mockSignedBlock);
        const { forkId, height } = mockBlock.coordinates;
        mockForkId = forkId;
        mockHeight = height;
    });

    describe("Queue Operations", () => {
        it("should queue blocks", () => {
            const hash = storage.queueBlock(mockBlock);
            expect(storage.isBlockQueued(mockBlock)).to.be.true;
            expect(storage.isBlockQueued(mockBlock, { hash })).to.be.true;
        });

        it("should queue multiple blocks on same coordinates", () => {
            const block1 = Block.fromSignedBlock(
                factory.signedBlock({
                    encodedBlock: factory
                        .block({
                            transaction: factory.transaction({
                                header: factory.transactionHeader({
                                    forkId: mockForkId,
                                    transactionCnt: mockHeight
                                })
                            })
                        })
                        .encode()
                })
            );

            const block2 = Block.fromSignedBlock(
                factory.signedBlock({
                    encodedBlock: factory
                        .block({
                            transaction: factory.transaction({
                                header: factory.transactionHeader({
                                    forkId: mockForkId,
                                    transactionCnt: mockHeight
                                })
                            })
                        })
                        .encode()
                })
            );

            storage.queueBlock(block1);
            storage.queueBlock(block2);

            const dequeued = storage.tryDequeue(mockForkId, mockHeight);
            expect(dequeued).to.have.lengthOf(2);
            expect(dequeued[0].equals(block1)).to.be.true;
            expect(dequeued[1].equals(block2)).to.be.true;
        });
    });

    describe("Signature Merging", () => {
        it("should merge signatures when queueing same block multiple times", () => {
            const sharedSig = sig();
            const uniqueSig1 = sig();
            const uniqueSig2 = sig();

            // First confirmation
            storage.queueBlock(
                Block.fromBlockConfirmation({
                    ...mockBlockConfirmation,
                    signatures: [sharedSig, uniqueSig1]
                })
            );

            // Second confirmation with shared signature
            storage.queueBlock(
                Block.fromBlockConfirmation({
                    ...mockBlockConfirmation,
                    signatures: [sharedSig, uniqueSig2]
                })
            );

            const dequeued = storage.tryDequeue(mockForkId, mockHeight);
            expect(dequeued).to.have.lengthOf(1);
            expect(dequeued[0].confirmationSignatures.size).to.equal(3);
            expect(dequeued[0].confirmationSignatures).to.deep.equal(
                new Set([sharedSig, uniqueSig1, uniqueSig2])
            );
        });

        it("should merge signatures with existing queued block", () => {
            storage.queueBlock(mockBlock);
            storage.queueBlock(
                Block.fromBlockConfirmation({
                    ...mockBlockConfirmation,
                    signatures: [sig(), sig()]
                })
            );

            const dequeued = storage.tryDequeue(mockForkId, mockHeight);
            expect(dequeued).to.have.lengthOf(1);
            expect(dequeued[0].confirmationSignatures.size).to.equal(2);
        });

        it("should merge on-chain timestamp when queueing same block again", () => {
            const onChainTimestamp = 1234567890;
            storage.queueBlock(mockBlock);

            storage.queueBlock(
                Block.fromSignedBlock(mockSignedBlock, onChainTimestamp)
            );

            const dequeued = storage.tryDequeue(mockForkId, mockHeight);
            expect(dequeued).to.have.lengthOf(1);
            expect(dequeued[0].onChainTimestamp).to.equal(onChainTimestamp);
        });

        it("should merge on-chain timestamp when checking queued duplicate", () => {
            const onChainTimestamp = 1234567890;
            storage.queueBlock(mockBlock);

            const blockPostedOnChain = Block.fromSignedBlock(
                mockSignedBlock,
                onChainTimestamp
            );
            expect(storage.isBlockQueued(blockPostedOnChain)).to.be.true;

            const dequeued = storage.tryDequeue(mockForkId, mockHeight);
            expect(dequeued).to.have.lengthOf(1);
            expect(dequeued[0].onChainTimestamp).to.equal(onChainTimestamp);
        });

        it("should merge on-chain timestamp through storage proxy", () => {
            const storageWithProxy = new Storage();
            const onChainTimestamp = 1234567890;
            storageWithProxy.queues.queueBlock(mockBlock);

            const blockPostedOnChain = Block.fromSignedBlock(
                mockSignedBlock,
                onChainTimestamp
            );
            expect(storageWithProxy.queues.isBlockQueued(blockPostedOnChain)).to
                .be.true;

            const dequeued = storageWithProxy.queues.tryDequeue(
                mockForkId,
                mockHeight
            );
            expect(dequeued).to.have.lengthOf(1);
            expect(dequeued[0].onChainTimestamp).to.equal(onChainTimestamp);
        });
    });

    describe("Dequeue Operations", () => {
        it("should allow multiple dequeues on different coordinates", () => {
            const block1 = Block.fromSignedBlock(
                factory.signedBlock({
                    encodedBlock: factory
                        .block({
                            transaction: factory.transaction({
                                header: factory.transactionHeader({
                                    forkId: mockForkId,
                                    transactionCnt: mockHeight
                                })
                            })
                        })
                        .encode()
                })
            );

            const block2 = Block.fromSignedBlock(
                factory.signedBlock({
                    encodedBlock: factory
                        .block({
                            transaction: factory.transaction({
                                header: factory.transactionHeader({
                                    forkId: mockForkId,
                                    transactionCnt: mockHeight + 1
                                })
                            })
                        })
                        .encode()
                })
            );

            storage.queueBlock(block1);
            storage.queueBlock(block2);

            const dequeued1 = storage.tryDequeue(mockForkId, mockHeight);
            const dequeued2 = storage.tryDequeue(mockForkId, mockHeight + 1);

            expect(dequeued1).to.have.lengthOf(1);
            expect(dequeued2).to.have.lengthOf(1);
            expect(dequeued1[0].equals(block1)).to.be.true;
            expect(dequeued2[0].equals(block2)).to.be.true;
        });

        it("should return empty on subsequent dequeues", () => {
            storage.queueBlock(mockBlock);
            expect(storage.tryDequeue(mockForkId, mockHeight)).to.have.lengthOf(
                1
            );
            expect(storage.tryDequeue(mockForkId, mockHeight)).to.deep.equal(
                []
            );
        });
    });

    describe("Deep Copy Isolation", () => {
        let storageWithProxy: Storage;
        beforeEach(() => {
            storageWithProxy = new Storage();
        });

        it("should isolate modifications from outside objects", () => {
            const originalConfirmation = factory.blockConfirmation({
                signedBlock: mockSignedBlock,
                signatures: [sig(), sig()]
            });
            const originalCount = originalConfirmation.signatures.length;

            storageWithProxy.queues.queueBlock(
                Block.fromBlockConfirmation(originalConfirmation)
            );
            storageWithProxy.queues.queueBlock(
                Block.fromBlockConfirmation({
                    ...mockBlockConfirmation,
                    signatures: [sig()]
                })
            );

            // Original object should be unchanged
            expect(originalConfirmation.signatures).to.have.lengthOf(
                originalCount
            );

            const dequeued = storageWithProxy.queues.tryDequeue(
                mockForkId,
                mockHeight
            );
            expect(dequeued[0].confirmationSignatures.size).to.be.greaterThan(
                originalCount
            );
        });

        it("should isolate modifications to dequeued objects", () => {
            const confirmation = factory.blockConfirmation({
                signedBlock: mockSignedBlock,
                signatures: [sig()]
            });

            storageWithProxy.queues.queueBlock(
                Block.fromBlockConfirmation(confirmation)
            );
            const dequeued = storageWithProxy.queues.tryDequeue(
                mockForkId,
                mockHeight
            );
            const originalCount = dequeued[0].confirmationSignatures.size;

            // Modify dequeued object
            dequeued[0].expandSignatures([sig()]);

            // Queue same confirmation again
            storageWithProxy.queues.queueBlock(
                Block.fromBlockConfirmation(confirmation)
            );
            const dequeued2 = storageWithProxy.queues.tryDequeue(
                mockForkId,
                mockHeight
            );

            // Storage should not be affected
            expect(dequeued2[0].confirmationSignatures.size).to.equal(
                originalCount
            );
        });
    });
});
