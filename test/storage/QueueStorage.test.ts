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
    let mockForkId: ForkId;
    let mockHeight: BlockHeight;

    beforeEach(() => {
        storage = new QueueStorage();
        mockSignedBlock = factory.signedBlock();
        mockBlockConfirmation = factory.blockConfirmation({
            signedBlock: mockSignedBlock
        });

        const block = Block.decode(mockSignedBlock.encodedBlock);
        const { forkId, height } = block.coordinates;
        mockForkId = forkId;
        mockHeight = height;
    });

    describe("Queue Operations", () => {
        it("should queue blocks and convert SignedBlock to BlockConfirmationStruct", () => {
            const confirmation = {
                signedBlock: mockSignedBlock,
                signatures: [mockSignedBlock.signature]
            };

            const hash = storage.queueBlock(mockSignedBlock);
            expect(storage.isBlockQueued(confirmation)).to.be.true;
            expect(storage.isBlockQueued(confirmation, { hash })).to.be.true;
        });

        it("should queue multiple blocks on same coordinates", () => {
            const block1 = factory.signedBlock({
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
            });

            const block2 = factory.signedBlock({
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
            });

            storage.queueBlock(block1);
            storage.queueBlock(block2);

            const dequeued = storage.tryDequeueConfirmations(
                mockForkId,
                mockHeight
            );
            expect(dequeued).to.have.lengthOf(2);
            expect(dequeued[0].signedBlock).to.equal(block1);
            expect(dequeued[1].signedBlock).to.equal(block2);
        });
    });

    describe("Signature Merging", () => {
        it("should merge signatures when queueing same block multiple times", () => {
            const sharedSig = sig();
            const uniqueSig1 = sig();
            const uniqueSig2 = sig();

            // First confirmation
            storage.queueConfirmation({
                ...mockBlockConfirmation,
                signatures: [sharedSig, uniqueSig1]
            });

            // Second confirmation with shared signature
            storage.queueConfirmation({
                ...mockBlockConfirmation,
                signatures: [sharedSig, uniqueSig2]
            });

            const dequeued = storage.tryDequeueConfirmations(
                mockForkId,
                mockHeight
            );
            expect(dequeued).to.have.lengthOf(1);
            expect(dequeued[0].signatures).to.have.lengthOf(3);
            expect(dequeued[0].signatures).to.include.members([
                sharedSig,
                uniqueSig1,
                uniqueSig2
            ]);
        });

        it("should merge signatures with existing queued block", () => {
            storage.queueBlock(mockSignedBlock);
            storage.queueConfirmation({
                ...mockBlockConfirmation,
                signatures: [sig(), sig()]
            });

            const dequeued = storage.tryDequeueConfirmations(
                mockForkId,
                mockHeight
            );
            expect(dequeued).to.have.lengthOf(1);
            expect(dequeued[0].signatures).to.have.lengthOf(2);
        });
    });

    describe("Dequeue Operations", () => {
        it("should allow multiple dequeues on different coordinates", () => {
            const block1 = factory.signedBlock({
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
            });

            const block2 = factory.signedBlock({
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
            });

            storage.queueBlock(block1);
            storage.queueBlock(block2);

            const dequeued1 = storage.tryDequeueConfirmations(
                mockForkId,
                mockHeight
            );
            const dequeued2 = storage.tryDequeueConfirmations(
                mockForkId,
                mockHeight + 1
            );

            expect(dequeued1).to.have.lengthOf(1);
            expect(dequeued2).to.have.lengthOf(1);
            expect(dequeued1[0].signedBlock).to.equal(block1);
            expect(dequeued2[0].signedBlock).to.equal(block2);
        });

        it("should return empty on subsequent dequeues", () => {
            storage.queueBlock(mockSignedBlock);
            expect(
                storage.tryDequeueConfirmations(mockForkId, mockHeight)
            ).to.have.lengthOf(1);
            expect(
                storage.tryDequeueConfirmations(mockForkId, mockHeight)
            ).to.deep.equal([]);
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

            storageWithProxy.queues.queueConfirmation(originalConfirmation);
            storageWithProxy.queues.queueConfirmation({
                ...mockBlockConfirmation,
                signatures: [sig()]
            });

            // Original object should be unchanged
            expect(originalConfirmation.signatures).to.have.lengthOf(
                originalCount
            );

            const dequeued = storageWithProxy.queues.tryDequeueConfirmations(
                mockForkId,
                mockHeight
            );
            expect(dequeued[0].signatures.length).to.be.greaterThan(
                originalCount
            );
        });

        it("should isolate modifications to dequeued objects", () => {
            const confirmation = factory.blockConfirmation({
                signedBlock: mockSignedBlock,
                signatures: [sig()]
            });

            storageWithProxy.queues.queueConfirmation(confirmation);
            const dequeued = storageWithProxy.queues.tryDequeueConfirmations(
                mockForkId,
                mockHeight
            );
            const originalCount = dequeued[0].signatures.length;

            // Modify dequeued object
            dequeued[0].signatures.push(sig());

            // Queue same confirmation again
            storageWithProxy.queues.queueConfirmation(confirmation);
            const dequeued2 = storageWithProxy.queues.tryDequeueConfirmations(
                mockForkId,
                mockHeight
            );

            // Storage should not be affected
            expect(dequeued2[0].signatures).to.have.lengthOf(originalCount);
        });
    });
});
