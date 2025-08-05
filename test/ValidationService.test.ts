import { expect } from "chai";
import { ethers } from "hardhat";
import { describe, it, beforeEach } from "mocha";
import ValidationService from "@/stateManager/ValidationService";
import Storage from "@/storage";
import { Block } from "@/models";
import * as factory from "./factory";
import { AgreementFlag, ExecutionFlags } from "@/types";
import AgreementManager from "@/agreementManager";
import DisputeHandler from "@/DisputeHandler";
import ADiamondStateMachine from "@/ADiamondStateMachine";
import { StateChannelManagerProxy } from "@typechain-types/contracts/V1/StateChannelDiamondProxy";

class PublicStateSnapshot {
    constructor(public snapshot: any) {}
}

describe("ValidationService", () => {
    let storage: any;
    let validationService: any;
    let block: Block;
    let agreementManager: AgreementManager;
    let disputeHandler: DisputeHandler;
    let stateMachine: ADiamondStateMachine;
    let scmContract: StateChannelManagerProxy;
    const dummyTimeCfg = {
        p2pTime: 10,
        agreementTime: 10,
        chainFallbackTime: 10,
        challengeTime: 10
    };

    beforeEach(() => {
        storage = new Storage();
        agreementManager = {} as AgreementManager;
        disputeHandler = {} as DisputeHandler;
        stateMachine = {} as ADiamondStateMachine;
        scmContract = {} as StateChannelManagerProxy;
        validationService = new ValidationService(
            storage,
            agreementManager,
            stateMachine,
            disputeHandler,
            scmContract,
            dummyTimeCfg,
            () => ethers.ZeroAddress,
            ethers.ZeroAddress,
            async () => ExecutionFlags.SUCCESS
        );
        block = factory.block();
    });

    describe("isBlockInChain", () => {
        it("returns true if block is in chain and matches", async () => {
            const signedBlock = await block.signedBlock(
                ethers.Wallet.createRandom()
            );
            storage.blocks.storeBlock(signedBlock);
            const result = (validationService as any)["isBlockInChain"](block);
            expect(result).to.be.true;
        });

        it("returns false if block is not in chain", () => {
            const result = (validationService as any)["isBlockInChain"](block);
            expect(result).to.be.false;
        });

        it("returns false if block hash matches but content does not", async () => {
            const otherBlock = factory.block({
                previousBlockHash: ethers.hexlify(ethers.randomBytes(32))
            });
            const signedOther = await otherBlock.signedBlock(
                ethers.Wallet.createRandom()
            );
            storage.blocks.storeBlock(signedOther);
            const result = (validationService as any)["isBlockInChain"](block);
            expect(result).to.be.false;
        });
    });

    describe("isBlockDuplicate", () => {
        it("returns true if block is in chain", async () => {
            const signedBlock = await block.signedBlock(
                ethers.Wallet.createRandom()
            );
            storage.blocks.storeBlock(signedBlock);
            expect((validationService as any)["isBlockDuplicate"](block)).to.be
                .true;
        });

        it("returns true if block is in queue", async () => {
            const signedBlock = await block.signedBlock(
                ethers.Wallet.createRandom()
            );
            storage.queues.queueBlock(signedBlock);
            expect((validationService as any)["isBlockDuplicate"](block)).to.be
                .true;
        });

        it("returns false if block is not in chain or queue", () => {
            expect((validationService as any)["isBlockDuplicate"](block)).to.be
                .false;
        });
    });

    describe("getLatestBlockTimestamp", () => {
        it("returns genesis timestamp if no blocks in fork", () => {
            const forkId = block.forkId;
            const genesisTimestamp = 1234567890;
            (storage.stateSnapshots as any).getGenesisSnapshotDataByForkId =
                () => new PublicStateSnapshot({ timestamp: genesisTimestamp });
            const ts = (validationService as any)["getLatestBlockTimestamp"](
                forkId
            );
            expect(ts).to.equal(genesisTimestamp);
        });

        it("returns latest block timestamp if blocks exist", async () => {
            const forkId = block.forkId;
            const genesisTimestamp = 1234567890;
            (storage.stateSnapshots as any).getGenesisSnapshotDataByForkId =
                () => new PublicStateSnapshot({ timestamp: genesisTimestamp });
            const signedBlock = await block.signedBlock(
                ethers.Wallet.createRandom()
            );
            storage.blocks.storeBlock(signedBlock);
            const ts = (validationService as any)["getLatestBlockTimestamp"](
                forkId
            );
            expect(ts).to.equal(block.timestamp);
        });
    });

    describe("checkBlock", () => {
        it("returns INVALID_SIGNATURE if signature is invalid", async () => {
            // Create a block and sign it with a different wallet (not the author)
            const otherWallet = ethers.Wallet.createRandom();
            const blockInstance = factory.block();
            const message = ethers.getBytes(blockInstance.hash);
            const wrongSignature = await otherWallet.signMessage(message);
            const signedBlock = factory.signedBlock({
                encodedBlock: blockInstance.encode(),
                signature: wrongSignature
            });
            expect(
                (validationService as any)["checkBlock"](signedBlock)
            ).to.equal(AgreementFlag.INVALID_SIGNATURE);
        });

        it("returns DUPLICATE if block is duplicate", async () => {
            // Create a wallet for the author
            const authorWallet = ethers.Wallet.createRandom();
            // Create a block with the author's address
            const blockInstance = factory.block({
                transaction: factory.transaction({
                    header: factory.transactionHeader({
                        participant: authorWallet.address
                    })
                })
            });
            // Sign the block with the author's wallet
            const signature = await authorWallet.signMessage(
                ethers.getBytes(blockInstance.hash)
            );
            const signedBlock = factory.signedBlock({
                encodedBlock: blockInstance.encode(),
                signature
            });
            storage.blocks.storeBlock(signedBlock);

            // Create a duplicate signed block with the same encoded block and signature
            const dupeSigned = factory.signedBlock({
                encodedBlock: blockInstance.encode(),
                signature
            });

            expect(
                (validationService as any)["checkBlock"](dupeSigned)
            ).to.equal(AgreementFlag.DUPLICATE);
        });

        it("returns NOT_READY if fork is unknown (no genesis snapshot)", async () => {
            // Create a wallet for the author
            const authorWallet = ethers.Wallet.createRandom();
            // Create a block with the author's address
            const blockInstance = factory.block({
                transaction: factory.transaction({
                    header: factory.transactionHeader({
                        participant: authorWallet.address
                    })
                })
            });
            const signature = await authorWallet.signMessage(
                ethers.getBytes(blockInstance.hash)
            );
            const signedBlock = factory.signedBlock({
                encodedBlock: blockInstance.encode(),
                signature
            });
            // Patch stateSnapshots to always return undefined (unknown fork)
            (storage.stateSnapshots as any).getGenesisSnapshotDataByForkId =
                () => undefined;
            expect(
                (validationService as any)["checkBlock"](signedBlock)
            ).to.equal(AgreementFlag.NOT_READY);
        });

        it("returns DOUBLE_SIGN if author already signed block at height", async () => {
            // Create a wallet for the author
            const authorWallet = ethers.Wallet.createRandom();
            // Create a block at height 1
            const blockInstance = factory.block({
                transaction: factory.transaction({
                    header: factory.transactionHeader({
                        participant: authorWallet.address,
                        transactionCnt: 1
                    })
                })
            });
            const signature = await authorWallet.signMessage(
                ethers.getBytes(blockInstance.hash)
            );
            const signedBlock = factory.signedBlock({
                encodedBlock: blockInstance.encode(),
                signature
            });
            // Store a block at the same forkId and height, with the same author
            const forkId = blockInstance.forkId;
            const height = blockInstance.height;
            const blockConfirmation = {
                signedBlock: signedBlock,
                signatures: []
            };
            (storage.blocks as any).getBlockEntry = (fId: any, h: any) => {
                if (fId === forkId && h === height) {
                    return { blockConfirmation };
                }
                return undefined;
            };
            // Patch stateSnapshots to return a valid genesis snapshot
            (storage.stateSnapshots as any).getGenesisSnapshotDataByForkId =
                () => new PublicStateSnapshot({ timestamp: 123 });
            expect(
                (validationService as any)["checkBlock"](signedBlock)
            ).to.equal(AgreementFlag.DOUBLE_SIGN);
        });

        it("returns INCORRECT_DATA if block at height is from a different author", async () => {
            // Create a wallet for the author
            const authorWallet = ethers.Wallet.createRandom();
            // Create a block at height 1
            const blockInstance = factory.block({
                transaction: factory.transaction({
                    header: factory.transactionHeader({
                        participant: authorWallet.address,
                        transactionCnt: 1
                    })
                })
            });
            const signature = await authorWallet.signMessage(
                ethers.getBytes(blockInstance.hash)
            );
            const signedBlock = factory.signedBlock({
                encodedBlock: blockInstance.encode(),
                signature
            });
            // Store a block at the same forkId and height, with a different author
            const forkId = blockInstance.forkId;
            const height = blockInstance.height;
            const otherWallet = ethers.Wallet.createRandom();
            const otherBlockInstance = factory.block({
                transaction: factory.transaction({
                    header: factory.transactionHeader({
                        participant: otherWallet.address,
                        transactionCnt: 1,
                        forkId: forkId
                    })
                })
            });
            const otherSignature = await otherWallet.signMessage(
                ethers.getBytes(otherBlockInstance.hash)
            );
            const otherSignedBlock = factory.signedBlock({
                encodedBlock: otherBlockInstance.encode(),
                signature: otherSignature
            });
            const blockConfirmation = {
                signedBlock: otherSignedBlock,
                signatures: []
            };
            (storage.blocks as any).getBlockEntry = (fId: any, h: any) => {
                if (fId === forkId && h === height) {
                    return { blockConfirmation };
                }
                return undefined;
            };
            // Patch stateSnapshots to return a valid genesis snapshot
            (storage.stateSnapshots as any).getGenesisSnapshotDataByForkId =
                () => new PublicStateSnapshot({ timestamp: 123 });
            expect(
                (validationService as any)["checkBlock"](signedBlock)
            ).to.equal(AgreementFlag.INCORRECT_DATA);
        });

        it("returns READY for genesis block with correct previousBlockHash", async () => {
            // Create a wallet for the author
            const authorWallet = ethers.Wallet.createRandom();
            // Create a random stateMachineStateHash
            const stateMachineStateHash = ethers.hexlify(
                ethers.randomBytes(32)
            );
            const expectedPrev = ethers.keccak256(stateMachineStateHash);
            // Create a block at height 0 with the correct previousBlockHash
            const forkId = ethers.hexlify(ethers.randomBytes(32));
            const blockInstance = factory.block({
                transaction: factory.transaction({
                    header: factory.transactionHeader({
                        participant: authorWallet.address,
                        transactionCnt: 0,
                        forkId: forkId
                    })
                }),
                previousBlockHash: expectedPrev
            });
            const signature = await authorWallet.signMessage(
                ethers.getBytes(blockInstance.hash)
            );
            const signedBlock = factory.signedBlock({
                encodedBlock: blockInstance.encode(),
                signature
            });
            // Patch stateSnapshots to return a genesis snapshot with the stateMachineStateHash
            (storage.stateSnapshots as any).getGenesisSnapshotDataByForkId =
                () =>
                    new PublicStateSnapshot({
                        snapshotData: { stateMachineStateHash },
                        timestamp: 123
                    });
            // Patch blocks.getBlockEntry to return undefined for genesis
            (storage.blocks as any).getBlockEntry = () => undefined;
            expect(
                (validationService as any)["checkBlock"](signedBlock)
            ).to.equal(AgreementFlag.READY);
        });

        it("returns INCORRECT_DATA for genesis block with wrong previousBlockHash", async () => {
            // Create a wallet for the author
            const authorWallet = ethers.Wallet.createRandom();
            // Create a block at height 0
            const forkId = ethers.hexlify(ethers.randomBytes(32));
            const expectedPrev = ethers.hexlify(ethers.randomBytes(32));
            const wrongPrev = ethers.hexlify(ethers.randomBytes(32));
            const blockInstance = factory.block({
                transaction: factory.transaction({
                    header: factory.transactionHeader({
                        participant: authorWallet.address,
                        transactionCnt: 0,
                        forkId: forkId
                    })
                }),
                previousBlockHash: wrongPrev
            });
            const signature = await authorWallet.signMessage(
                ethers.getBytes(blockInstance.hash)
            );
            const signedBlock = factory.signedBlock({
                encodedBlock: blockInstance.encode(),
                signature
            });
            // Patch stateSnapshots to return a genesis snapshot with the expected stateMachineStateHash
            (storage.stateSnapshots as any).getGenesisSnapshotDataByForkId =
                () =>
                    new PublicStateSnapshot({
                        snapshotData: { stateMachineStateHash: expectedPrev },
                        timestamp: 123
                    });
            // Patch blocks.getBlockEntry to return undefined for genesis
            (storage.blocks as any).getBlockEntry = () => undefined;
            expect(
                (validationService as any)["checkBlock"](signedBlock)
            ).to.equal(AgreementFlag.INCORRECT_DATA);
        });

        it("returns NOT_READY if previous block is missing for non-genesis block", async () => {
            // Create a wallet for the author
            const authorWallet = ethers.Wallet.createRandom();
            // Create a block at height 2
            const forkId = ethers.hexlify(ethers.randomBytes(32));
            const blockInstance = factory.block({
                transaction: factory.transaction({
                    header: factory.transactionHeader({
                        participant: authorWallet.address,
                        transactionCnt: 2,
                        forkId: forkId
                    })
                })
            });
            const signature = await authorWallet.signMessage(
                ethers.getBytes(blockInstance.hash)
            );
            const signedBlock = factory.signedBlock({
                encodedBlock: blockInstance.encode(),
                signature
            });
            // Patch stateSnapshots to return a valid genesis snapshot
            (storage.stateSnapshots as any).getGenesisSnapshotDataByForkId =
                () => new PublicStateSnapshot({ timestamp: 123 });
            // Patch blocks.getBlockEntry to return undefined for previous block
            (storage.blocks as any).getBlockEntry = (fId: any, h: any) =>
                undefined;
            expect(
                (validationService as any)["checkBlock"](signedBlock)
            ).to.equal(AgreementFlag.NOT_READY);
        });

        it("returns READY if previous block hash matches for non-genesis block", async () => {
            // Create a wallet for the author
            const authorWallet = ethers.Wallet.createRandom();
            // Create a block at height 2
            const forkId = ethers.hexlify(ethers.randomBytes(32));
            const prevBlockInstance = factory.block({
                transaction: factory.transaction({
                    header: factory.transactionHeader({
                        participant: authorWallet.address,
                        transactionCnt: 1,
                        forkId: forkId
                    })
                })
            });
            const prevSignature = await authorWallet.signMessage(
                ethers.getBytes(prevBlockInstance.hash)
            );
            const prevSignedBlock = factory.signedBlock({
                encodedBlock: prevBlockInstance.encode(),
                signature: prevSignature
            });
            const prevBlockHash = prevBlockInstance.hash;
            const blockInstance = factory.block({
                transaction: factory.transaction({
                    header: factory.transactionHeader({
                        participant: authorWallet.address,
                        transactionCnt: 2,
                        forkId: forkId
                    })
                }),
                previousBlockHash: prevBlockHash
            });
            const signature = await authorWallet.signMessage(
                ethers.getBytes(blockInstance.hash)
            );
            const signedBlock = factory.signedBlock({
                encodedBlock: blockInstance.encode(),
                signature
            });
            // Patch stateSnapshots to return a valid genesis snapshot
            (storage.stateSnapshots as any).getGenesisSnapshotDataByForkId =
                () => new PublicStateSnapshot({ timestamp: 123 });
            // Patch blocks.getBlockEntry to return the previous block for height-1
            (storage.blocks as any).getBlockEntry = (fId: any, h: any) => {
                if (h === 1) {
                    return {
                        blockConfirmation: {
                            signedBlock: prevSignedBlock,
                            signatures: []
                        }
                    };
                }
                return undefined;
            };
            expect(
                (validationService as any)["checkBlock"](signedBlock)
            ).to.equal(AgreementFlag.READY);
        });

        it("returns INCORRECT_DATA if previous block hash does not match for non-genesis block", async () => {
            // Create a wallet for the author
            const authorWallet = ethers.Wallet.createRandom();
            // Create a block at height 2
            const forkId = ethers.hexlify(ethers.randomBytes(32));
            const prevBlockInstance = factory.block({
                transaction: factory.transaction({
                    header: factory.transactionHeader({
                        participant: authorWallet.address,
                        transactionCnt: 1,
                        forkId: forkId
                    })
                })
            });
            const prevSignature = await authorWallet.signMessage(
                ethers.getBytes(prevBlockInstance.hash)
            );
            const prevSignedBlock = factory.signedBlock({
                encodedBlock: prevBlockInstance.encode(),
                signature: prevSignature
            });
            const blockInstance = factory.block({
                transaction: factory.transaction({
                    header: factory.transactionHeader({
                        participant: authorWallet.address,
                        transactionCnt: 2,
                        forkId: forkId
                    })
                }),
                previousBlockHash: ethers.hexlify(ethers.randomBytes(32)) // wrong hash
            });
            const signature = await authorWallet.signMessage(
                ethers.getBytes(blockInstance.hash)
            );
            const signedBlock = factory.signedBlock({
                encodedBlock: blockInstance.encode(),
                signature
            });
            // Patch stateSnapshots to return a valid genesis snapshot
            (storage.stateSnapshots as any).getGenesisSnapshotDataByForkId =
                () => new PublicStateSnapshot({ timestamp: 123 });
            // Patch blocks.getBlockEntry to return the previous block for height-1
            (storage.blocks as any).getBlockEntry = (fId: any, h: any) => {
                if (h === 1) {
                    return {
                        blockConfirmation: {
                            signedBlock: prevSignedBlock,
                            signatures: []
                        }
                    };
                }
                return undefined;
            };
            expect(
                (validationService as any)["checkBlock"](signedBlock)
            ).to.equal(AgreementFlag.INCORRECT_DATA);
        });
    });
});
