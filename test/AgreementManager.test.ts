import { expect } from "chai";
import { ethers } from "hardhat";
import * as factory from "./factory";
import EvmUtils from "@/utils/EvmUtils";
import {
    BlockStruct,
    SignedBlockStruct
} from "@typechain-types/contracts/V1/DataTypes";
import sinon from "sinon";
import AgreementManager from "@/agreementManager/AgreementManager";
import { AgreementFlag } from "@/types";
import { SignatureLike, Signer } from "ethers";

describe("AgreementManager", () => {
    const commonEncodedState = ethers.hexlify(ethers.randomBytes(32));
    const commonGenesisState = ethers.hexlify(ethers.randomBytes(32));
    const commonGenesisState2 = ethers.hexlify(ethers.randomBytes(32));
    const nowTimestamp = Math.floor(Date.now() / 1000);

    let signers: Signer[];
    let signer1: Signer;
    let signer2: Signer;
    let nonParticipantWallet: Signer;
    let address1: string;
    let address2: string;
    let nonParticipantAddress: string;
    let block: BlockStruct;
    let signedBlock: SignedBlockStruct;
    let invalidForkBlock: BlockStruct;
    let invalidTxBlock: BlockStruct;
    let differentParticipantBlock: BlockStruct;

    let wallet2Signature: SignatureLike;

    let agreementManager: AgreementManager;
    let signature: SignatureLike;
    let encodedState: string;

    let createInitializedManager: () => AgreementManager;

    before(async () => {
        signers = await ethers.getSigners();
        signer1 = signers[0];
        signer2 = signers[1];
        nonParticipantWallet = signers[2];

        address1 = await signer1.getAddress();
        address2 = await signer2.getAddress();
        nonParticipantAddress = await nonParticipantWallet.getAddress();

        // Helper function to create an initialized instance

        createInitializedManager = () => {
            const manager = factory.agreementManager([address1, address2]);
            manager.newFork(
                commonGenesisState,
                [address1, address2],
                0,
                nowTimestamp
            );
            return manager;
        };

        block = factory.block({
            transaction: factory.transaction({
                header: factory.transactionHeader({
                    participant: address1
                })
            })
        });

        invalidForkBlock = factory.block({
            transaction: factory.transaction({
                header: factory.transactionHeader({
                    forkCnt: 99
                })
            })
        });

        invalidTxBlock = factory.block({
            transaction: factory.transaction({
                header: factory.transactionHeader({
                    transactionCnt: 99
                })
            })
        });

        differentParticipantBlock = factory.block({
            transaction: factory.transaction({
                header: factory.transactionHeader({
                    participant: address2
                })
            })
        });

        signedBlock = await EvmUtils.signBlock(block, signer1);
        signature = signedBlock.signature as SignatureLike;
        wallet2Signature = (await EvmUtils.signBlock(block, signer2))
            .signature as SignatureLike;

        encodedState = commonEncodedState;

        agreementManager = createInitializedManager();
    });

    describe("newFork", () => {
        let localAgreementManager: AgreementManager;
        let addresses: string[];

        before(() => {
            localAgreementManager = new AgreementManager();
            addresses = [address1, address2];
        });

        it("should create a new fork when forkCnt matches current length", () => {
            const forkCnt = 0;
            localAgreementManager.newFork(
                commonGenesisState,
                addresses,
                forkCnt,
                nowTimestamp
            );

            expect(localAgreementManager.forks.nextForkIndex()).to.equal(1);
            expect(
                localAgreementManager.forks.forkAt(0)?.forkGenesisStateEncoded
            ).to.equal(commonGenesisState);
            const fork = localAgreementManager.forks.forkAt(0);
            expect(fork?.addressesInThreshold).to.deep.equal(addresses);
            expect(fork?.genesisTimestamp).to.equal(nowTimestamp);
            expect(fork?.chainBlocks).to.deep.equal([]);
            expect(fork?.agreements).to.deep.equal([]);
        });

        it("should not create a new fork when forkCnt doesn't match current length", () => {
            const freshManager = new AgreementManager();
            const incorrectForkCnt = 1;

            freshManager.newFork(
                commonGenesisState,
                addresses,
                incorrectForkCnt,
                nowTimestamp
            );

            expect(freshManager.forks.latestForkCnt()).to.equal(0);
        });

        it("should allow multiple forks to be created sequentially", () => {
            const freshManager = new AgreementManager();

            freshManager.newFork(
                commonGenesisState,
                addresses,
                0,
                nowTimestamp
            );
            freshManager.newFork(
                commonGenesisState2,
                addresses,
                1,
                nowTimestamp + 100
            );

            expect(freshManager.forks.nextForkIndex()).to.equal(2);
            expect(
                freshManager.forks.forkAt(0)?.forkGenesisStateEncoded
            ).to.equal(commonGenesisState);
            expect(
                freshManager.forks.forkAt(1)?.forkGenesisStateEncoded
            ).to.equal(commonGenesisState2);
        });
    });

    describe("isBlockInChain", () => {
        describe("When checking for blocks in the canonical chain", () => {
            let testAgreementManager: AgreementManager;

            before(() => {
                testAgreementManager = createInitializedManager();
            });

            it("should return false if the block does not exist in the canonical chain", () => {
                expect(testAgreementManager.isBlockInChain(block)).to.be.false;
            });

            it("should return true if the block exists in the canonical chain", () => {
                testAgreementManager.addBlock(block, signature, encodedState);
                expect(testAgreementManager.isBlockInChain(block)).to.be.true;
            });

            it("should return false if a block with same coordinates but different content exists", () => {
                const differentBlock = factory.block();
                expect(testAgreementManager.isBlockInChain(differentBlock)).to
                    .be.false;
            });
        });

        describe("When checking blocks with different fork or transaction counts", () => {
            it("should return false if the fork count is out of range", () => {
                expect(agreementManager.isBlockInChain(invalidForkBlock)).to.be
                    .false;
            });

            it("should return false if the transaction count is out of range", () => {
                expect(agreementManager.isBlockInChain(invalidTxBlock)).to.be
                    .false;
            });
        });

        describe("Edge cases", () => {
            it("should handle empty forks array", () => {
                const emptyManager = new AgreementManager();
                expect(emptyManager.isBlockInChain(block)).to.be.false;
            });

            it("should handle fork with no agreements", () => {
                const manager = new AgreementManager();
                manager.newFork(
                    commonGenesisState,
                    [address1],
                    0,
                    nowTimestamp
                );
                expect(manager.isBlockInChain(block)).to.be.false;
            });
        });
    });

    describe("isBlockDuplicate", () => {
        describe("When checking for duplicates in the canonical chain", () => {
            it("should return true if the block exists in the canonical chain", () => {
                const isBlockInChainStub = sinon
                    .stub(agreementManager, "isBlockInChain")
                    .returns(true);

                expect(agreementManager.isBlockDuplicate(block)).to.be.true;
                isBlockInChainStub.restore();
            });

            it("should return false if the block does not exist in the canonical chain", () => {
                expect(agreementManager.isBlockDuplicate(block)).to.be.false;
            });
        });

        describe("When checking for duplicates in the not-ready map", () => {
            let testAgreementManager: AgreementManager;

            before(() => {
                testAgreementManager = createInitializedManager();
                testAgreementManager.queueBlock(signedBlock);
            });

            it("should return true if the exact same block exists in the not-ready map", () => {
                expect(testAgreementManager.isBlockDuplicate(block)).to.be.true;
            });

            it("should return false if the fork is not in the not-ready map", () => {
                const differentForkBlock = factory.block({
                    transaction: factory.transaction({
                        header: factory.transactionHeader({
                            forkCnt: 1
                        })
                    })
                });
                expect(
                    testAgreementManager.isBlockDuplicate(differentForkBlock)
                ).to.be.false;
            });

            it("should return false if the transaction count is not in the not-ready map", () => {
                const differentTxBlock = factory.block({
                    transaction: factory.transaction({
                        header: factory.transactionHeader({
                            transactionCnt: 1
                        })
                    })
                });
                expect(testAgreementManager.isBlockDuplicate(differentTxBlock))
                    .to.be.false;
            });

            it("should return false if the participant address is not in the not-ready map", () => {
                expect(
                    testAgreementManager.isBlockDuplicate(
                        differentParticipantBlock
                    )
                ).to.be.false;
            });

            it("should return false if a different block with same coordinates exists in the not-ready map", async () => {
                const localManager = createInitializedManager();
                localManager.queueBlock(signedBlock);

                const differentContentBlock = factory.block({
                    transaction: factory.transaction({
                        header: factory.transactionHeader({
                            participant: block.transaction.header
                                .participant as string
                        })
                    }),
                    previousStateHash: ethers.hexlify(ethers.randomBytes(32))
                });
                const differentSignedBlock = await EvmUtils.signBlock(
                    differentContentBlock,
                    signer1
                );

                localManager.queueBlock(differentSignedBlock);

                expect(localManager.isBlockDuplicate(block)).to.be.false;
                expect(localManager.isBlockDuplicate(differentContentBlock)).to
                    .be.true;
            });
        });
    });

    describe("addBlock", () => {
        let testAgreementManager: AgreementManager;

        before(() => {
            testAgreementManager = createInitializedManager();
        });

        it("should throw error when fork count is invalid", () => {
            expect(() =>
                testAgreementManager.addBlock(
                    invalidForkBlock,
                    signature,
                    encodedState
                )
            ).to.throw("AgreementManager - addBlock - forkCnt is not correct");
        });

        it("should throw error when agreement already exists", () => {
            testAgreementManager.addBlock(block, signature, encodedState);
            expect(() =>
                testAgreementManager.addBlock(block, signature, encodedState)
            ).to.throw(
                "AgreementManager - addBlock - double sign or incorrect data"
            );
        });

        it("should correctly update state when adding a new block", () => {
            const freshManager = createInitializedManager();
            freshManager.addBlock(block, signature, encodedState);

            const forkCnt = Number(block.transaction.header.forkCnt);
            const txCnt = Number(block.transaction.header.transactionCnt);
            const agreement = freshManager.forks.agreement(forkCnt, txCnt);

            expect(agreement).to.not.be.undefined;
            expect(agreement!.block).to.deep.equal(block);
            expect(agreement!.blockSignatures).to.include(signature);
            expect(agreement!.encodedState).to.equal(encodedState);
        });
    });

    describe("confirmBlock", () => {
        let testAgreementManager: AgreementManager;

        before(() => {
            testAgreementManager = createInitializedManager();
            testAgreementManager.addBlock(block, signature, encodedState);
        });

        it("should throw error when agreement doesn't exist", () => {
            expect(() =>
                testAgreementManager.confirmBlock(
                    invalidTxBlock,
                    wallet2Signature
                )
            ).to.throw("AgreementManager - confirmBlock - block doesn't exist");
        });

        it("should throw error when encoded block doesn't match existing block", () => {
            const differentBlock = factory.block({
                transaction: block.transaction,
                previousStateHash: ethers.hexlify(ethers.randomBytes(32))
            });

            expect(() =>
                testAgreementManager.confirmBlock(
                    differentBlock,
                    wallet2Signature
                )
            ).to.throw("AgreementManager - confirmBlock - conflict");
        });

        it("should throw error when block is already confirmed by the same signer", () => {
            testAgreementManager.confirmBlock(block, wallet2Signature);
            expect(() =>
                testAgreementManager.confirmBlock(block, wallet2Signature)
            ).to.throw(
                "AgreementManager - confirmBlock - block already confirmed"
            );
        });

        it("should correctly update state when confirming a block", () => {
            const freshManager = createInitializedManager();
            freshManager.addBlock(block, signature, encodedState);
            freshManager.confirmBlock(block, wallet2Signature);

            const forkCnt = Number(block.transaction.header.forkCnt);
            const txCnt = Number(block.transaction.header.transactionCnt);
            const agreement = freshManager.forks.agreement(forkCnt, txCnt);

            expect(agreement!.blockSignatures).to.have.lengthOf(2);
            expect(agreement!.blockSignatures).to.include(signature);
            expect(agreement!.blockSignatures).to.include(wallet2Signature);
        });
    });

    describe("getLatestForkCnt", () => {
        it("should return -1 when there are no forks", () => {
            const emptyManager = new AgreementManager();
            expect(emptyManager.getLatestForkCnt()).to.equal(0);
        });

        it("should return the correct index of the latest fork", () => {
            const localManager = createInitializedManager();
            expect(localManager.getLatestForkCnt()).to.equal(0);

            // Add another fork
            localManager.newFork(
                commonGenesisState,
                [address1],
                1,
                nowTimestamp
            );

            expect(localManager.forks.latestForkCnt()).to.equal(1);
        });
    });

    describe("getNextTransactionCnt", () => {
        it("should return 0 when there are no forks", () => {
            const emptyManager = new AgreementManager();
            expect(emptyManager.getNextBlockHeight()).to.equal(0);
        });

        it("should return 0 when the latest fork has no agreements", () => {
            const localManager = createInitializedManager();
            expect(localManager.getNextBlockHeight()).to.equal(0);
        });

        it("should return the correct next transaction count after adding blocks", async () => {
            const localManager = createInitializedManager();

            localManager.addBlock(block, signature, encodedState);
            expect(localManager.getNextBlockHeight()).to.equal(1);

            // Create and add another block with transaction count 1
            const block1 = factory.block({
                transaction: factory.transaction({
                    header: factory.transactionHeader({
                        transactionCnt: 1
                    })
                })
            });
            const signature1 = await signer1.signMessage(
                EvmUtils.encodeBlock(block1)
            );
            localManager.addBlock(block1, signature1, encodedState);

            expect(localManager.getNextBlockHeight()).to.equal(2);
        });
    });

    describe("getBlock", () => {
        let localManager: AgreementManager;

        before(() => {
            localManager = createInitializedManager();

            localManager.addBlock(block, signature, encodedState);
        });

        it("should return undefined for invalid fork count", () => {
            const invalidForkCnt = 99;
            const transactionCnt = 0;

            expect(localManager.getBlock(invalidForkCnt, transactionCnt)).to.be
                .undefined;
        });

        it("should return undefined for invalid transaction count", () => {
            const forkCnt = 0;
            const invalidTransactionCnt = 99;

            expect(localManager.getBlock(forkCnt, invalidTransactionCnt)).to.be
                .undefined;
        });

        it("should return the correct block when it exists", () => {
            const forkCnt = Number(block.transaction.header.forkCnt);
            const transactionCnt = Number(
                block.transaction.header.transactionCnt
            );

            const retrievedBlock = localManager.getBlock(
                forkCnt,
                transactionCnt
            );

            expect(retrievedBlock).to.not.be.undefined;
            expect(EvmUtils.encodeBlock(retrievedBlock!)).to.equal(
                EvmUtils.encodeBlock(block)
            );
        });
    });

    describe("getDoubleSignedBlock", () => {
        let localManager: AgreementManager;

        before(async () => {
            localManager = createInitializedManager();

            localManager.addBlock(block, signature, encodedState);
        });

        it("should return undefined when block doesn't exist", () => {
            const emptyManager = new AgreementManager();
            expect(emptyManager.getDoubleSignedBlock(signedBlock)).to.be
                .undefined;
        });

        it("should return undefined when block exists but isn't double signed", async () => {
            const differentParticipantBlock = {
                ...block,
                transaction: {
                    ...block.transaction,
                    header: {
                        ...block.transaction.header,
                        participant: address2
                    }
                }
            };

            const differentSignedBlock: SignedBlockStruct = {
                encodedBlock: EvmUtils.encodeBlock(differentParticipantBlock),
                signature: await signer2.signMessage(
                    EvmUtils.encodeBlock(differentParticipantBlock)
                )
            };

            expect(localManager.getDoubleSignedBlock(differentSignedBlock)).to
                .be.undefined;
        });

        it("should return the originally signed block when double signing is detected", async () => {
            const second_block = factory.block({
                transaction: factory.transaction({
                    header: factory.transactionHeader({
                        participant: block.transaction.header.participant
                    })
                })
            });

            const doubleSignedBlock = await EvmUtils.signBlock(
                second_block,
                signer1
            );
            const result = localManager.getDoubleSignedBlock(doubleSignedBlock);

            expect(result).to.not.be.undefined;
            expect(result!.encodedBlock).to.equal(EvmUtils.encodeBlock(block));
            expect(result!.signature).to.equal(signature);
        });
    });

    describe("getLatestSignedBlockByParticipant", () => {
        let localManager: AgreementManager;

        before(async () => {
            localManager = createInitializedManager();

            localManager.addBlock(block, signature, encodedState);

            // Create and add a second block with higher transaction count
            const block1 = factory.block({
                transaction: factory.transaction({
                    header: factory.transactionHeader({
                        transactionCnt: 1,
                        participant: address1 // Same participant
                    })
                })
            });

            const signature1 = (await EvmUtils.signBlock(block1, signer1))
                .signature as SignatureLike;
            localManager.addBlock(block1, signature1, encodedState);
        });

        it("should return undefined for invalid fork count", () => {
            const invalidForkCnt = 99;

            expect(
                localManager.getLatestSignedBlockByParticipant(
                    invalidForkCnt,
                    address1
                )
            ).to.be.undefined;
        });

        it("should return undefined when participant hasn't signed any blocks", () => {
            const forkCnt = 0;

            // Check for a different participant
            expect(
                localManager.getLatestSignedBlockByParticipant(
                    forkCnt,
                    nonParticipantAddress
                )
            ).to.be.undefined;
        });

        it("should return the latest block signed by the participant", () => {
            const result = localManager.getLatestSignedBlockByParticipant(
                0,
                address1
            );

            expect(result).to.not.be.undefined;
            expect(result!.block.transaction.header.transactionCnt).to.equal(1); // Should be the second block (transactionCnt=1)
        });
    });

    describe("didEveryoneSignBlock", () => {
        it("should return false for invalid fork count", () => {
            const invalidForkBlock = factory.block({
                transaction: factory.transaction({
                    header: factory.transactionHeader({
                        forkCnt: 99
                    })
                })
            });

            expect(agreementManager.didEveryoneSignBlock(invalidForkBlock)).to
                .be.false;
        });

        it("should return false when the block doesn't exist", () => {
            const localManager = createInitializedManager();
            expect(localManager.didEveryoneSignBlock(block)).to.be.false;
        });

        it("should return false when the block content doesn't match the stored one", async () => {
            const localManager = createInitializedManager();
            localManager.addBlock(block, signature, encodedState);

            // Create a different block with the same coordinates
            const differentBlock = factory.block({
                transaction: block.transaction,
                previousStateHash: ethers.hexlify(ethers.randomBytes(32))
            });

            expect(localManager.didEveryoneSignBlock(differentBlock)).to.be
                .false;
        });

        it("should return false when not everyone has signed the block", () => {
            const localManager = createInitializedManager();

            localManager.addBlock(block, signature, encodedState);

            expect(localManager.didEveryoneSignBlock(block)).to.be.false;
        });

        it("should return true when all threshold participants have signed the block", async () => {
            const localManager = createInitializedManager();

            localManager.addBlock(block, signature, encodedState);

            localManager.confirmBlock(block, wallet2Signature);

            // Now all threshold participants (wallet and wallet2) have signed
            expect(localManager.didEveryoneSignBlock(block)).to.be.true;
        });

        it("should return false when a signature is from a non-participant in the fork", async () => {
            const localManager = createInitializedManager();

            // Add the block signed by wallet (a valid participant)
            localManager.addBlock(block, signature, encodedState);

            // confirm with a signature from a non-participant
            const nonParticipantSignature = (
                await EvmUtils.signBlock(block, nonParticipantWallet)
            ).signature as SignatureLike;
            localManager.confirmBlock(block, nonParticipantSignature);

            // Despite having the right number of signatures, one is from a non-participant
            expect(localManager.didEveryoneSignBlock(block)).to.be.false;
        });
    });

    describe("getOriginalSignature", () => {
        let localManager: AgreementManager;

        before(async () => {
            localManager = createInitializedManager();

            localManager.addBlock(block, signature, encodedState);

            localManager.confirmBlock(block, wallet2Signature);
        });

        it("should return undefined when block doesn't exist", () => {
            const nonExistentBlock = factory.block({
                transaction: factory.transaction({
                    header: factory.transactionHeader({
                        transactionCnt: 99 // Doesn't exist
                    })
                })
            });

            expect(localManager.getOriginalSignature(nonExistentBlock)).to.be
                .undefined;
        });

        it("should return the original signature for an existing block", () => {
            expect(localManager.getOriginalSignature(block)).to.equal(
                signature
            );
        });

        it("should return author signature when there are multiple signatures", () => {
            expect(localManager.getOriginalSignature(block)).to.equal(
                signature
            );
        });
    });

    describe("doesSignatureExist", () => {
        let localManager: AgreementManager;

        before(async () => {
            localManager = createInitializedManager();

            localManager.addBlock(block, signature, encodedState);
        });

        it("should return false when block doesn't exist", () => {
            const nonExistentBlock = factory.block({
                transaction: factory.transaction({
                    header: factory.transactionHeader({
                        transactionCnt: 99 // Doesn't exist
                    })
                })
            });

            expect(localManager.doesSignatureExist(nonExistentBlock, signature))
                .to.be.false;
        });

        it("should throw error when block exists but with different content", () => {
            const differentBlock = factory.block({
                transaction: block.transaction,
                previousStateHash: ethers.hexlify(ethers.randomBytes(32)) // Different content
            });

            expect(() =>
                localManager.doesSignatureExist(differentBlock, signature)
            ).to.throw("AgreementManager - doesSignatureExist - conflict");
        });

        it("should return true when signature exists for the block", () => {
            expect(localManager.doesSignatureExist(block, signature)).to.be
                .true;
        });

        it("should return false when signature doesn't exist for the block", () => {
            expect(localManager.doesSignatureExist(block, wallet2Signature)).to
                .be.false;
        });
    });

    describe("didParticipantSign", () => {
        let localManager: AgreementManager;

        before(() => {
            localManager = createInitializedManager();

            localManager.addBlock(block, signature, encodedState);
        });

        it("should return false when block doesn't exist", () => {
            const nonExistentBlock = factory.block({
                transaction: factory.transaction({
                    header: factory.transactionHeader({
                        transactionCnt: 99 // Doesn't exist
                    })
                })
            });

            expect(
                localManager.didParticipantSign(nonExistentBlock, address1)
            ).to.deep.equal({ didSign: false, signature: undefined });
        });

        it("should return false when block exists but with different content", () => {
            const differentBlock = factory.block({
                transaction: block.transaction,
                previousStateHash: ethers.hexlify(ethers.randomBytes(32)) // Different content
            });

            expect(
                localManager.didParticipantSign(differentBlock, address1)
            ).to.deep.equal({ didSign: false, signature: undefined });
        });

        it("should return true with signature when participant has signed", () => {
            expect(
                localManager.didParticipantSign(block, address1)
            ).to.deep.equal({ didSign: true, signature });
        });

        it("should return false when participant hasn't signed", () => {
            expect(
                localManager.didParticipantSign(block, address2)
            ).to.deep.equal({ didSign: false, signature: undefined });
        });
    });

    describe("isParticipantInLatestFork", () => {
        let localManager: AgreementManager;

        before(() => {
            localManager = createInitializedManager();
        });

        it("should return true when participant is in the latest fork", () => {
            expect(localManager.isParticipantInLatestFork(address1)).to.be.true;
            expect(localManager.isParticipantInLatestFork(address2)).to.be.true;
        });

        it("should return false when participant is not in the latest fork", () => {
            expect(
                localManager.isParticipantInLatestFork(nonParticipantAddress)
            ).to.be.false;
        });

        it("should reflect changes when a new fork is created", () => {
            // Create a new fork with different participants
            localManager.newFork(
                commonGenesisState,
                [nonParticipantAddress],
                1,
                nowTimestamp
            );

            // Original participants should no longer be in latest fork
            expect(localManager.isParticipantInLatestFork(address1)).to.be
                .false;
            expect(localManager.isParticipantInLatestFork(address2)).to.be
                .false;

            // New participant should be in latest fork
            expect(
                localManager.isParticipantInLatestFork(nonParticipantAddress)
            ).to.be.true;
        });
    });

    describe("getFinalizedAndLatestWithVotes", () => {
        let blocks: BlockStruct[] = [];
        let encodedBlocks: string[] = [];
        let states: string[] = [];

        // Signatures structure: signatures[blockIndex][walletIndex]
        let signatures: SignatureLike[][] = [];

        before(async () => {
            // Create sequential blocks with different states
            const block0 = factory.block({
                transaction: factory.transaction({
                    header: factory.transactionHeader({
                        transactionCnt: 0,
                        participant: address1
                    })
                }),
                previousStateHash: ethers.keccak256(commonGenesisState)
            });

            const block1 = factory.block({
                transaction: factory.transaction({
                    header: factory.transactionHeader({
                        transactionCnt: 1,
                        participant: address1
                    })
                }),
                previousStateHash: block0.stateHash
            });

            const block2 = factory.block({
                transaction: factory.transaction({
                    header: factory.transactionHeader({
                        transactionCnt: 2,
                        participant: address1
                    })
                }),
                previousStateHash: block1.stateHash
            });

            blocks = [block0, block1, block2];

            encodedBlocks = blocks.map(EvmUtils.encodeBlock);

            states = [
                commonGenesisState, // Use this directly as state0
                ethers.keccak256(commonGenesisState), // Use hash of genesis state for state1
                ethers.keccak256(ethers.concat([commonGenesisState, "0x01"])) // Use another deterministic value for state2
            ];

            signatures = Array(blocks.length)
                .fill(0)
                .map(() => []);

            // Generate signatures for each block by each wallet
            const wallets = [signer1, signer2];

            for (let blockIdx = 0; blockIdx < blocks.length; blockIdx++) {
                for (
                    let walletIdx = 0;
                    walletIdx < wallets.length;
                    walletIdx++
                ) {
                    const signature = (
                        await EvmUtils.signBlock(
                            blocks[blockIdx],
                            wallets[walletIdx]
                        )
                    ).signature as SignatureLike;

                    signatures[blockIdx][walletIdx] = signature;
                }
            }
        });

        it("should return the genesis state when no agreements exist", () => {
            const emptyManager = new AgreementManager();
            emptyManager.newFork(
                commonGenesisState,
                [address1, address2],
                0,
                nowTimestamp
            );

            expect(
                emptyManager.getFinalizedAndLatestWithVotes(0, address1)
            ).to.deep.equal({
                encodedLatestFinalizedState: commonGenesisState,
                encodedLatestCorrectState: commonGenesisState,
                virtualVotingBlocks: []
            });
        });

        it("should return the genesis state for a signer with no agreements", () => {
            // Add one agreement signed only by wallet1
            const testManager = createInitializedManager();
            testManager.addBlock(blocks[0], signatures[0][0], states[0]);
            const fork0GenesisState = testManager.getForkGenesisStateEncoded(0);

            expect(
                testManager.getFinalizedAndLatestWithVotes(
                    0,
                    address2 // This wallet hasn't signed anything
                )
            ).to.deep.equal({
                encodedLatestFinalizedState: fork0GenesisState,
                encodedLatestCorrectState: fork0GenesisState,
                virtualVotingBlocks: []
            });
        });

        it("should return the latest signed state for a signer when no state is fully finalized", () => {
            const testManager = createInitializedManager();

            // Add all three blocks with only wallet1 signatures
            blocks.forEach((block, idx) => {
                testManager.addBlock(block, signatures[idx][0], states[idx]);
            });

            const result = testManager.getFinalizedAndLatestWithVotes(
                0,
                address1 // Only wallet1 has signed all blocks
            );

            // Latest finalized should be genesis (no full consensus)
            expect(result.encodedLatestFinalizedState).to.equal(
                testManager.getForkGenesisStateEncoded(0)
            );
            // Latest correct should be states[2] (latest wallet1 signed)
            expect(result.encodedLatestCorrectState).to.equal(states[2]);
            // Virtual voting blocks should include all blocks wallet1 signed
            expect(result.virtualVotingBlocks).to.have.lengthOf(3);

            result.virtualVotingBlocks.forEach((vote, idx) => {
                expect(vote.encodedBlock).to.equal(encodedBlocks[idx]);
            });
        });

        it("should return a finalized state when all threshold signers have signed it", () => {
            const testManager = createInitializedManager();

            // Block0: Both wallets sign
            testManager.addBlock(blocks[0], signatures[0][0], states[0]);
            testManager.confirmBlock(blocks[0], signatures[0][1]);

            // Block1 and Block2: Only wallet1 signs
            testManager.addBlock(blocks[1], signatures[1][0], states[1]);
            testManager.addBlock(blocks[2], signatures[2][0], states[2]);

            // Test for wallet1 which signed all blocks
            const resultWallet1 = testManager.getFinalizedAndLatestWithVotes(
                0,
                address1
            );

            // Latest finalized should be states[0] (both wallets signed)
            expect(resultWallet1.encodedLatestFinalizedState).to.equal(
                states[0]
            );
            // Latest correct should be states[2] (latest wallet1 signed)
            expect(resultWallet1.encodedLatestCorrectState).to.equal(states[2]);
            // Virtual voting blocks should include all blocks
            expect(resultWallet1.virtualVotingBlocks).to.have.lengthOf(3);

            // Test for wallet2 which only signed block0
            const resultWallet2 = testManager.getFinalizedAndLatestWithVotes(
                0,
                address2
            );

            // Latest finalized should be states[0] (both wallets signed)
            expect(resultWallet2.encodedLatestFinalizedState).to.equal(
                states[0]
            );
            // Latest correct should be states[0] (latest wallet2 signed)
            expect(resultWallet2.encodedLatestCorrectState).to.equal(states[0]);
            // Virtual voting blocks should only include block0
            expect(resultWallet2.virtualVotingBlocks).to.have.lengthOf(1);
            expect(resultWallet2.virtualVotingBlocks[0].encodedBlock).to.equal(
                encodedBlocks[0]
            );
        });

        it("should handle a mix of signatures with partially finalized states", async () => {
            const testManager = createInitializedManager();

            // Block0: only wallet1 signs
            testManager.addBlock(blocks[0], signatures[0][0], states[0]);

            // Block1: both wallets sign
            testManager.addBlock(blocks[1], signatures[1][0], states[1]);
            testManager.confirmBlock(blocks[1], signatures[1][1]);

            // Block2: only wallet2 signs
            testManager.addBlock(blocks[2], signatures[2][1], states[2]);

            // Test for wallet1
            const resultWallet1 = testManager.getFinalizedAndLatestWithVotes(
                0,
                address1
            );

            // Since both wallets signed block2, the latest finalized state should be states[2]
            expect(resultWallet1.encodedLatestFinalizedState).to.equal(
                states[1]
            );
            expect(resultWallet1.encodedLatestCorrectState).to.equal(states[1]);
            expect(resultWallet1.virtualVotingBlocks).to.have.lengthOf(1);

            // Test for wallet2
            const resultWallet2 = testManager.getFinalizedAndLatestWithVotes(
                0,
                address2
            );

            // Same finalized state, but for wallet2 the latest correct state is the last one it signed
            expect(resultWallet2.encodedLatestFinalizedState).to.equal(
                states[1]
            );
            expect(resultWallet2.encodedLatestCorrectState).to.equal(states[2]);

            expect(resultWallet2.virtualVotingBlocks).to.have.lengthOf(2);
        });
    });

    describe("getFinalizedAndLatestWithVotes- virtual voting", () => {
        let testManager: AgreementManager;
        let blocks: BlockStruct[] = [];
        let encodedStates: string[] = [];
        let signatures: SignatureLike[][] = [];
        let signers_3: Signer[];

        let addresses: string[];

        before(async () => {
            // Get three signers
            signers_3 = signers.slice(0, 3);
            addresses = await Promise.all(signers_3.map((s) => s.getAddress()));

            // Create sequential blocks
            const block0 = factory.block({
                transaction: factory.transaction({
                    header: factory.transactionHeader({
                        transactionCnt: 0,
                        participant: addresses[0]
                    })
                }),
                previousStateHash: ethers.keccak256(commonGenesisState)
            });

            const block1 = factory.block({
                transaction: factory.transaction({
                    header: factory.transactionHeader({
                        transactionCnt: 1,
                        participant: addresses[0]
                    })
                }),
                previousStateHash: block0.stateHash
            });

            const block2 = factory.block({
                transaction: factory.transaction({
                    header: factory.transactionHeader({
                        transactionCnt: 2,
                        participant: addresses[0]
                    })
                }),
                previousStateHash: block1.stateHash
            });

            blocks = [block0, block1, block2];

            // Create distinct encoded states
            encodedStates = [
                ethers.hexlify(ethers.concat([commonGenesisState, "0x01"])),
                ethers.hexlify(ethers.concat([commonGenesisState, "0x02"])),
                ethers.hexlify(ethers.concat([commonGenesisState, "0x03"]))
            ];

            // Generate signatures for all blocks by all signers
            signatures = Array(blocks.length)
                .fill(0)
                .map(() => []);

            for (let blockIdx = 0; blockIdx < blocks.length; blockIdx++) {
                for (
                    let signerIdx = 0;
                    signerIdx < signers.length;
                    signerIdx++
                ) {
                    const signature = (
                        await EvmUtils.signBlock(
                            blocks[blockIdx],
                            signers[signerIdx]
                        )
                    ).signature as SignatureLike;
                    signatures[blockIdx][signerIdx] = signature;
                }
            }
        });

        it("should correctly identify finalized and latest states in scenario 1", async () => {
            testManager = new AgreementManager();
            testManager.newFork(commonGenesisState, addresses, 0, nowTimestamp);
            // Scenario 1:
            // Block 0 signed by all
            testManager.addBlock(blocks[0], signatures[0][0], encodedStates[0]);
            testManager.confirmBlock(blocks[0], signatures[0][1]);
            testManager.confirmBlock(blocks[0], signatures[0][2]);

            // Block 1 signed by all
            testManager.addBlock(blocks[1], signatures[1][0], encodedStates[1]);
            testManager.confirmBlock(blocks[1], signatures[1][1]);
            testManager.confirmBlock(blocks[1], signatures[1][2]);

            // Block 2 signed by participants 1 and 3 (not by participant 2)
            testManager.addBlock(blocks[2], signatures[2][0], encodedStates[2]);
            testManager.confirmBlock(blocks[2], signatures[2][2]);

            // Check from perspective of participant 3
            const result = testManager.getFinalizedAndLatestWithVotes(
                0,
                addresses[2]
            );

            // Latest correct state should be from Block 2 (since participant 3 signed it)
            expect(result.encodedLatestCorrectState).to.equal(encodedStates[2]);

            // Latest finalized state should be from Block 1 (last block signed by all participants)
            expect(result.encodedLatestFinalizedState).to.equal(
                encodedStates[1]
            );
        });

        it("should correctly identify finalized and latest states in scenario 2", async () => {
            testManager = new AgreementManager();
            testManager.newFork(commonGenesisState, addresses, 0, nowTimestamp);

            // Scenario 2:
            // Block 0 signed by all
            testManager.addBlock(blocks[0], signatures[0][0], encodedStates[0]);
            testManager.confirmBlock(blocks[0], signatures[0][1]);
            testManager.confirmBlock(blocks[0], signatures[0][2]);

            // Block 1 signed by participants 1 and 2 (not by participant 3)
            testManager.addBlock(blocks[1], signatures[1][0], encodedStates[1]);
            testManager.confirmBlock(blocks[1], signatures[1][1]);

            // Block 2 signed by participant 3 only
            testManager.addBlock(blocks[2], signatures[2][2], encodedStates[2]);

            // Check from perspective of participant 3
            const result = testManager.getFinalizedAndLatestWithVotes(
                0,
                addresses[2]
            );

            // Latest correct state should be from Block 2 (since participant 3 signed it)
            expect(result.encodedLatestCorrectState).to.equal(encodedStates[2]);

            // Latest finalized state should be from Block 1 (Virtal voted by participant 3 on block 2)
            expect(result.encodedLatestFinalizedState).to.equal(
                encodedStates[1]
            );
        });
    });

    describe("checkBlock", () => {
        let localManager: AgreementManager;

        before(async () => {
            localManager = createInitializedManager();
        });

        it("should return INVALID_SIGNATURE when signer doesn't match participant", async () => {
            // Sign the block with a different signer than the participant
            const invalidlySignedBlock = await EvmUtils.signBlock(
                block,
                signer2
            );
            expect(localManager.checkBlock(invalidlySignedBlock)).to.equal(
                AgreementFlag.INVALID_SIGNATURE
            );
        });

        it("should return DUPLICATE when block is a duplicate", async () => {
            localManager.addBlock(block, signature, commonEncodedState);

            expect(localManager.checkBlock(signedBlock)).to.equal(
                AgreementFlag.DUPLICATE
            );
        });

        it("should return DOUBLE_SIGN when same participant tries to sign different block with same coordinates", async () => {
            const manager = createInitializedManager();

            manager.addBlock(block, signature, commonEncodedState);

            // Create a different block with same coordinates but different content
            const secondBlock = factory.block({
                transaction: factory.transaction({
                    header: factory.transactionHeader({
                        forkCnt: 0,
                        transactionCnt: 0,
                        participant: address1
                    })
                }),
                previousStateHash: ethers.keccak256(commonGenesisState),
                stateHash: ethers.hexlify(ethers.randomBytes(32)) // Different state hash
            });

            const secondSignedBlock = await EvmUtils.signBlock(
                secondBlock,
                signer1
            );

            expect(manager.checkBlock(secondSignedBlock)).to.equal(
                AgreementFlag.DOUBLE_SIGN
            );
        });

        it("should return INCORRECT_DATA when previousStateHash doesn't match", async () => {
            const manager = createInitializedManager();

            manager.addBlock(block, signature, commonEncodedState);

            // Create a block for transaction 1 with incorrect previousStateHash
            const blockWithWrongHash = factory.block({
                transaction: factory.transaction({
                    header: factory.transactionHeader({
                        forkCnt: 0,
                        transactionCnt: 1,
                        participant: address1
                    })
                }),
                previousStateHash: ethers.hexlify(ethers.randomBytes(32)) // Wrong hash
            });

            const signedWrongHashBlock = await EvmUtils.signBlock(
                blockWithWrongHash,
                signer1
            );

            expect(manager.checkBlock(signedWrongHashBlock)).to.equal(
                AgreementFlag.INCORRECT_DATA
            );
        });

        it("should return NOT_READY when transactionCnt is in the future", async () => {
            const manager = createInitializedManager();

            const futureBlock = factory.block({
                transaction: factory.transaction({
                    header: factory.transactionHeader({
                        forkCnt: 0,
                        transactionCnt: 1, // Future transaction count
                        participant: address1
                    })
                }),
                previousStateHash: ethers.hexlify(ethers.randomBytes(32))
            });

            const signedFutureBlock = await EvmUtils.signBlock(
                futureBlock,
                signer1
            );
            expect(manager.checkBlock(signedFutureBlock)).to.equal(
                AgreementFlag.NOT_READY
            );
        });

        it("should return READY when the block is valid and follows a previous block", async () => {
            const manager = createInitializedManager();

            manager.addBlock(block, signature, commonEncodedState);

            // Create block 1 with correct previousStateHash
            const block1 = factory.block({
                transaction: factory.transaction({
                    header: factory.transactionHeader({
                        forkCnt: 0,
                        transactionCnt: 1,
                        participant: address1
                    })
                }),
                previousStateHash: block.stateHash // Correct hash
            });

            const signedBlock1 = await EvmUtils.signBlock(block1, signer1);

            expect(manager.checkBlock(signedBlock1)).to.equal(
                AgreementFlag.READY
            );
        });

        it("should return READY when the first block in a fork has correct previousStateHash", async () => {
            const freshManager = new AgreementManager();
            freshManager.newFork(
                commonGenesisState,
                [address1, address2],
                0,
                nowTimestamp
            );

            const blockWithCorrectHash = factory.block({
                transaction: factory.transaction({
                    header: factory.transactionHeader({
                        forkCnt: 0,
                        transactionCnt: 0,
                        participant: address1
                    })
                }),
                previousStateHash: ethers.keccak256(commonGenesisState)
            });

            const signedBlockWithCorrectHash = await EvmUtils.signBlock(
                blockWithCorrectHash,
                signer1
            );

            expect(
                freshManager.checkBlock(signedBlockWithCorrectHash)
            ).to.equal(AgreementFlag.READY);
        });
    });

    describe("collectOnChainBlock", () => {
        let manager: AgreementManager;
        let validBlock: BlockStruct;
        let signedBlock: SignedBlockStruct;
        const timestamp = Math.floor(Date.now() / 1000);

        before(async () => {
            manager = createInitializedManager();
            validBlock = factory.block({
                transaction: factory.transaction({
                    header: factory.transactionHeader({
                        forkCnt: 0,
                        transactionCnt: 0,
                        participant: address1
                    })
                }),
                previousStateHash: ethers.keccak256(
                    manager.forks.forkAt(0)?.forkGenesisStateEncoded ?? ""
                )
            });

            signedBlock = await EvmUtils.signBlock(validBlock, signer1);
        });

        it("should collect valid blocks and return READY flag", async () => {
            expect(
                manager.collectOnChainBlock(signedBlock, timestamp)
            ).to.equal(AgreementFlag.READY);
            expect(manager.didParticipantPostOnChain(0, 0, address1)).to.be
                .true;

            const chainBlocks = manager.forks.forkAt(0)?.chainBlocks;
            expect(chainBlocks).to.have.lengthOf(1);
            expect(chainBlocks![0].transactionCnt).to.equal(0);
            expect(chainBlocks![0].participantAdr).to.equal(address1);
            expect(chainBlocks![0].timestamp).to.equal(timestamp);
        });

        it("should not add to chain blocks when signature is invalid but should return appropriate flag", async () => {
            const manager = createInitializedManager();
            // Create an invalid signature by using a different signer
            const invalidSignedBlock = await EvmUtils.signBlock(
                validBlock,
                signer2
            );

            expect(
                manager.collectOnChainBlock(invalidSignedBlock, timestamp)
            ).to.equal(AgreementFlag.INVALID_SIGNATURE);

            const chainBlocks = manager.forks.forkAt(0)?.chainBlocks;
            expect(chainBlocks).to.have.lengthOf(0);
        });

        it("should prevent duplicates from the same participant", async () => {
            manager.collectOnChainBlock(signedBlock, timestamp);

            const result = manager.collectOnChainBlock(
                signedBlock,
                timestamp + 100
            );

            expect(result).to.equal(AgreementFlag.DUPLICATE);

            const chainBlocks = manager.forks.forkAt(0)?.chainBlocks;
            expect(chainBlocks).to.have.lengthOf(1);
            expect(chainBlocks![0].timestamp).to.equal(timestamp); // Original timestamp
        });
    });
});
