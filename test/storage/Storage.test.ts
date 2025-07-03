import { expect } from "chai";
import { describe, it, beforeEach } from "mocha";
import { ethers } from "ethers";
import Storage from "@/storage";
import {
    BlockConfirmationStruct,
    SignedBlockStruct,
    StateSnapshotStruct,
    ExitChannelBlockStruct,
    JoinChannelBlockStruct,
    BlockStruct,
    BalanceStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { Hash } from "@/types/types";
import * as factory from "../factory";
import { Codec, Type, BlockUtils } from "@/utils";

describe("Storage", () => {
    let storage: Storage;
    let mockSignedBlock: SignedBlockStruct;
    let mockBlockConfirmation: BlockConfirmationStruct;
    let mockBlockHash: Hash;
    let mockForkId: string;
    let mockHeight: number;
    let mockJoinBlock: JoinChannelBlockStruct;
    let mockExitBlock: ExitChannelBlockStruct;
    let mockStateSnapshot: StateSnapshotStruct;
    let mockStateSnapshotHash: Hash;

    beforeEach(() => {
        storage = new Storage();

        // Setup mock data
        mockSignedBlock = factory.signedBlock();
        mockBlockConfirmation = factory.blockConfirmation({
            signedBlock: mockSignedBlock
        });
        mockBlockHash = ethers.keccak256(mockSignedBlock.encodedBlock);

        const block = Codec.decode(mockSignedBlock.encodedBlock, Type.Block);
        const { forkId, height } = BlockUtils.getCoordinates(block);
        mockForkId = forkId;
        mockHeight = height;

        mockJoinBlock = factory.joinChannelBlock();
        mockExitBlock = factory.exitChannelBlock();
        mockStateSnapshot = factory.stateSnapshot();
        mockStateSnapshotHash = ethers.keccak256(
            Codec.encode(mockStateSnapshot, Type.StateSnapshot)
        );
    });

    describe("Block Storage Operations", () => {
        describe("insertBlock()", () => {
            it("should insert SignedBlock with coordinates", () => {
                const hash = storage.insertBlock(
                    mockSignedBlock,
                    mockBlockHash,
                    mockForkId,
                    mockHeight
                );
                expect(hash).to.equal(mockBlockHash);

                const stored = storage.getBlockConfirmation(hash);
                expect(stored?.signedBlock).to.deep.equal(mockSignedBlock);
                expect(stored?.signatures).to.deep.equal([]);
            });

            it("should insert BlockConfirmation with coordinates", () => {
                const hash = storage.insertBlock(
                    mockBlockConfirmation,
                    mockBlockHash,
                    mockForkId,
                    mockHeight
                );
                expect(hash).to.equal(mockBlockHash);

                const stored = storage.getBlockConfirmation(hash);
                expect(stored).to.deep.equal(mockBlockConfirmation);
            });

            it("should throw on duplicate insert by hash", () => {
                storage.insertBlock(
                    mockSignedBlock,
                    mockBlockHash,
                    mockForkId,
                    mockHeight
                );

                expect(() => {
                    storage.insertBlock(
                        mockSignedBlock,
                        mockBlockHash,
                        "fork2",
                        100
                    );
                }).to.throw(/already exists/);
            });

            it("should throw on duplicate insert by coordinates", () => {
                storage.insertBlock(
                    mockSignedBlock,
                    mockBlockHash,
                    mockForkId,
                    mockHeight
                );

                const differentHash = ethers.hexlify(ethers.randomBytes(32));
                expect(() => {
                    storage.insertBlock(
                        mockSignedBlock,
                        differentHash,
                        mockForkId,
                        mockHeight
                    );
                }).to.throw(/already exists/);
            });
        });

        describe("getBlockConfirmation()", () => {
            beforeEach(() => {
                storage.insertBlock(
                    mockBlockConfirmation,
                    mockBlockHash,
                    mockForkId,
                    mockHeight
                );
            });

            it("should get block by hash", () => {
                const result = storage.getBlockConfirmation(mockBlockHash);
                expect(result).to.deep.equal(mockBlockConfirmation);
            });

            it("should get block by coordinates", () => {
                const result = storage.getBlockConfirmation(
                    mockForkId,
                    mockHeight
                );
                expect(result).to.deep.equal(mockBlockConfirmation);
            });

            it("should return undefined for non-existent blocks", () => {
                expect(
                    storage.getBlockConfirmation(
                        ethers.hexlify(ethers.randomBytes(32))
                    )
                ).to.be.undefined;
                expect(storage.getBlockConfirmation("nonexistent", 999)).to.be
                    .undefined;
            });
        });

        describe("deleteBlock()", () => {
            beforeEach(() => {
                storage.insertBlock(
                    mockBlockConfirmation,
                    mockBlockHash,
                    mockForkId,
                    mockHeight
                );
            });

            it("should delete by hash", () => {
                expect(storage.deleteBlock(mockBlockHash)).to.be.true;
                expect(storage.getBlockConfirmation(mockBlockHash)).to.be
                    .undefined;
            });

            it("should delete by coordinates", () => {
                expect(storage.deleteBlock(mockForkId, mockHeight)).to.be.true;
                expect(storage.getBlockConfirmation(mockForkId, mockHeight)).to
                    .be.undefined;
            });

            it("should return false when deleting non-existent blocks", () => {
                expect(storage.deleteBlock("nonexistent")).to.be.false;
                expect(storage.deleteBlock("nonexistent", 999)).to.be.false;
            });
        });

        describe("insertSignature()", () => {
            beforeEach(() => {
                storage.insertBlock(
                    mockBlockConfirmation,
                    mockBlockHash,
                    mockForkId,
                    mockHeight
                );
            });

            it("should insert signature by hash", () => {
                const newSig = ethers.hexlify(ethers.randomBytes(65));
                const result = storage.insertSignature(newSig, mockBlockHash);

                expect(result).to.exist;
                expect(result?.signatures).to.include(newSig);
            });

            it("should insert signature by coordinates", () => {
                const newSig = ethers.hexlify(ethers.randomBytes(65));
                const result = storage.insertSignature(
                    newSig,
                    mockForkId,
                    mockHeight
                );

                expect(result).to.exist;
                expect(result?.signatures).to.include(newSig);
            });

            it("should return undefined for non-existent blocks", () => {
                const newSig = ethers.hexlify(ethers.randomBytes(65));
                expect(storage.insertSignature(newSig, "nonexistent")).to.be
                    .undefined;
                expect(storage.insertSignature(newSig, "nonexistent", 999)).to
                    .be.undefined;
            });
        });
    });

    describe("Join Channel Operations", () => {
        describe("storeJoinChannelBlock()", () => {
            it("should store block with auto-computed hash", () => {
                const hash = storage.storeJoinChannelBlock(mockJoinBlock);
                const expectedHash = ethers.keccak256(
                    Codec.encode(mockJoinBlock, Type.JoinChannelBlock)
                );
                expect(hash).to.equal(expectedHash);

                const stored = storage.getJoinChannelBlock(hash);
                expect(stored).to.deep.equal(mockJoinBlock);
            });

            it("should store block with provided hash", () => {
                const customHash = ethers.hexlify(ethers.randomBytes(32));
                const hash = storage.storeJoinChannelBlock(
                    mockJoinBlock,
                    customHash
                );
                expect(hash).to.equal(customHash);

                const stored = storage.getJoinChannelBlock(customHash);
                expect(stored).to.deep.equal(mockJoinBlock);
            });

            it("should throw on duplicate hash", () => {
                const hash = storage.storeJoinChannelBlock(mockJoinBlock);
                expect(() => {
                    storage.storeJoinChannelBlock(mockJoinBlock, hash);
                }).to.throw(/already exists/);
            });
        });

        describe("getJoinChannelBlock()", () => {
            let storedHash: Hash;

            beforeEach(() => {
                storedHash = storage.storeJoinChannelBlock(mockJoinBlock);
            });

            it("should get block by hash", () => {
                const result = storage.getJoinChannelBlock(storedHash);
                expect(result).to.deep.equal(mockJoinBlock);
            });

            it("should return undefined for non-existent block", () => {
                const nonExistentHash = ethers.hexlify(ethers.randomBytes(32));
                expect(storage.getJoinChannelBlock(nonExistentHash)).to.be
                    .undefined;
            });
        });

        describe("Latest Join Channel Block Operations", () => {
            let storedHash: Hash;

            beforeEach(() => {
                storedHash = storage.storeJoinChannelBlock(mockJoinBlock);
            });

            it("should get latest join channel block", () => {
                const result = storage.getLatestJoinChannelBlock();
                expect(result).to.deep.equal(mockJoinBlock);
            });

            it("should get latest join channel block hash", () => {
                const result = storage.getLatestJoinChannelBlockHash();
                expect(result).to.equal(storedHash);
            });
        });

        describe("Total Deposits Operations", () => {
            it("should handle total deposits", () => {
                const newBalance: BalanceStruct = {
                    amount: BigInt(1000),
                    data: "0x1234"
                };
                storage.setTotalDeposits(newBalance);
                expect(storage.getTotalDeposits()).to.deep.equal(newBalance);
            });
        });
    });

    describe("Exit Channel Operations", () => {
        describe("recordExitChannelBlock()", () => {
            it("should store block with auto-computed hash", () => {
                const hash = storage.recordExitChannelBlock(
                    mockExitBlock,
                    mockForkId,
                    mockHeight
                );
                const expectedHash = ethers.keccak256(
                    Codec.encode(mockExitBlock, Type.ExitChannelBlock)
                );
                expect(hash).to.equal(expectedHash);

                const stored = storage.getExitChannelBlock(hash);
                expect(stored).to.deep.equal(mockExitBlock);
            });

            it("should store block and record exit point", () => {
                const hash = storage.recordExitChannelBlock(
                    mockExitBlock,
                    mockForkId,
                    mockHeight
                );

                // Verify block is stored
                const stored = storage.getExitChannelBlock(hash);
                expect(stored).to.deep.equal(mockExitBlock);

                // Verify exit point is recorded
                const exitPoints = storage.getExitPoints(
                    { forkId: mockForkId, blockHeight: mockHeight },
                    { forkId: mockForkId, blockHeight: mockHeight }
                );
                expect(exitPoints).to.have.length(1);
                expect(exitPoints[0]).to.deep.equal({
                    forkId: mockForkId,
                    blockHeight: mockHeight
                });
            });
        });

        describe("getExitChannelBlock()", () => {
            let storedHash: Hash;

            beforeEach(() => {
                storedHash = storage.recordExitChannelBlock(
                    mockExitBlock,
                    mockForkId,
                    mockHeight
                );
            });

            it("should get block by hash", () => {
                const result = storage.getExitChannelBlock(storedHash);
                expect(result).to.deep.equal(mockExitBlock);
            });

            it("should return undefined for non-existent block", () => {
                const nonExistentHash = ethers.hexlify(ethers.randomBytes(32));
                expect(storage.getExitChannelBlock(nonExistentHash)).to.be
                    .undefined;
            });
        });

        describe("Latest Exit Channel Block Operations", () => {
            let storedHash: Hash;

            beforeEach(() => {
                storedHash = storage.recordExitChannelBlock(
                    mockExitBlock,
                    mockForkId,
                    mockHeight
                );
            });

            it("should get latest exit channel block", () => {
                const result = storage.getLatestExitChannelBlock();
                expect(result).to.deep.equal(mockExitBlock);
            });

            it("should get latest exit channel block hash", () => {
                const result = storage.getLatestExitChannelBlockHash();
                expect(result).to.equal(storedHash);
            });
        });

        describe("Total Withdrawals Operations", () => {
            it("should handle total withdrawals", () => {
                const newBalance: BalanceStruct = {
                    amount: BigInt(1000),
                    data: "0x1234"
                };
                storage.setTotalWithdrawals(newBalance);
                expect(storage.getTotalWithdrawals()).to.deep.equal(newBalance);
            });
        });

        describe("Exit Points Operations", () => {
            let mockForkId1: string;
            let mockForkId2: string;
            let mockExitBlock1: ExitChannelBlockStruct;
            let mockExitBlock2: ExitChannelBlockStruct;
            let mockExitBlock3: ExitChannelBlockStruct;

            beforeEach(() => {
                mockForkId1 = ethers.hexlify(ethers.randomBytes(32));
                mockForkId2 = ethers.hexlify(ethers.randomBytes(32));
                mockExitBlock1 = factory.exitChannelBlock();
                mockExitBlock2 = factory.exitChannelBlock();
                mockExitBlock3 = factory.exitChannelBlock();
            });

            it("should record exit points when storing exit channel blocks", () => {
                // Record three exit points across two forks
                storage.recordExitChannelBlock(mockExitBlock1, mockForkId1, 1);
                storage.recordExitChannelBlock(mockExitBlock2, mockForkId1, 5);
                storage.recordExitChannelBlock(mockExitBlock3, mockForkId2, 3);

                // Get exit points between first and second point in fork1
                const exitPointsFork1 = storage.getExitPoints(
                    { forkId: mockForkId1, blockHeight: 1 },
                    { forkId: mockForkId1, blockHeight: 5 }
                );
                expect(exitPointsFork1).to.have.length(2);
                expect(exitPointsFork1[0]).to.deep.equal({
                    forkId: mockForkId1,
                    blockHeight: 1
                });
                expect(exitPointsFork1[1]).to.deep.equal({
                    forkId: mockForkId1,
                    blockHeight: 5
                });

                // Get non-existent range should return empty array
                const nonExistentRange = storage.getExitPoints(
                    { forkId: mockForkId2, blockHeight: 1 },
                    { forkId: mockForkId2, blockHeight: 2 }
                );
                expect(nonExistentRange).to.have.length(0);
            });

            it("should handle invalid ranges for exit points", () => {
                storage.recordExitChannelBlock(mockExitBlock1, mockForkId1, 1);

                // Start point doesn't exist
                const invalidStart = storage.getExitPoints(
                    { forkId: "nonexistent", blockHeight: 0 },
                    { forkId: mockForkId1, blockHeight: 1 }
                );
                expect(invalidStart).to.have.length(0);

                // End point doesn't exist
                const invalidEnd = storage.getExitPoints(
                    { forkId: mockForkId1, blockHeight: 1 },
                    { forkId: "nonexistent", blockHeight: 999 }
                );
                expect(invalidEnd).to.have.length(0);
            });
        });
    });

    describe("State Snapshot Operations", () => {
        describe("storeStateSnapshot()", () => {
            it("should store snapshot with auto-computed hash", () => {
                const hash = storage.storeStateSnapshot(mockStateSnapshot);
                expect(hash).to.equal(mockStateSnapshotHash);

                const stored = storage.getStateSnapshotByHash(hash);
                expect(stored).to.deep.equal(mockStateSnapshot);
            });

            it("should store snapshot with provided hash", () => {
                const customHash = ethers.hexlify(ethers.randomBytes(32));
                const hash = storage.storeStateSnapshot(
                    mockStateSnapshot,
                    customHash
                );
                expect(hash).to.equal(customHash);

                const stored = storage.getStateSnapshotByHash(customHash);
                expect(stored).to.deep.equal(mockStateSnapshot);
            });

            it("should return undefined for non-existent snapshot hash", () => {
                const nonExistentHash = ethers.hexlify(ethers.randomBytes(32));
                expect(storage.getStateSnapshotByHash(nonExistentHash)).to.be
                    .undefined;
            });
        });
    });

    describe("Cached State Operations", () => {
        it("should handle cached on-chain state snapshot", () => {
            expect(storage.getCachedOnChainStateSnapshot()).to.be.undefined;

            const timestamp = Math.floor(Date.now() / 1000);
            storage.setCachedOnChainStateSnapshot(mockStateSnapshot, timestamp);

            const cached = storage.getCachedOnChainStateSnapshot();
            expect(cached).to.deep.equal({
                stateSnapshot: mockStateSnapshot,
                timestamp
            });
        });
    });
});
