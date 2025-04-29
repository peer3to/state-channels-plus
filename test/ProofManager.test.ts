import { expect } from "chai";
import sinon from "sinon";
import { ethers } from "hardhat";
import { SignedBlockStruct } from "@typechain-types/contracts/V1/DataTypes";
import {
    ProofStruct,
    DisputeStruct,
    FoldRechallengeProofStruct,
    DoubleSignProofStruct
} from "@typechain-types/contracts/V1/DisputeTypes";
import ProofManager from "@/ProofManager";
import AgreementManager from "@/agreementManager";
import { ProofType } from "@/types/disputes";
import { EvmUtils } from "@/utils";
import * as factory from "./factory";
import { AddressLike, Signer } from "ethers";

describe("ProofManager", () => {
    let agreementManager: AgreementManager;
    let proofManager: ProofManager;

    before(() => {
        agreementManager = factory.agreementManager();
        proofManager = new ProofManager(agreementManager);
    });

    describe("encode/decode", () => {
        it("should correctly encode and decode proof", () => {
            const block = factory.block();
            const mockProof: FoldRechallengeProofStruct = {
                encodedBlock: EvmUtils.encodeBlock(block),
                signatures: [
                    ethers.hexlify(ethers.randomBytes(65)),
                    ethers.hexlify(ethers.randomBytes(65))
                ]
            };

            const encoded = ProofManager.encodeProof(
                ProofType.FoldRechallenge,
                mockProof
            );
            expect(encoded).to.not.be.undefined;

            const decoded = ProofManager.decodeProof(
                ProofType.FoldRechallenge,
                encoded!
            );

            expect(decoded).to.deep.equal(mockProof);
        });
    });

    describe("proofs creation", () => {
        describe("createFoldRechallengeProof", () => {
            it("should return undefined if block does not exist", () => {
                const getBlockStub = sinon
                    .stub(agreementManager, "getBlock")
                    .returns(undefined);

                const proof = proofManager.createFoldRechallengeProof(1, 2);

                expect(proof).to.be.undefined;
                getBlockStub.restore();
            });

            it("should return undefined if not everyone signed the block", () => {
                const mockBlockObj = factory.block();
                const getBlockStub = sinon
                    .stub(agreementManager, "getBlock")
                    .returns(mockBlockObj);
                const didEveryoneSignStub = sinon
                    .stub(agreementManager, "didEveryoneSignBlock")
                    .returns(false);

                const proof = proofManager.createFoldRechallengeProof(1, 2);

                expect(proof).to.be.undefined;
                getBlockStub.restore();
                didEveryoneSignStub.restore();
            });

            it("should create a valid fold rechallenge proof when conditions are met", () => {
                const mockBlockObj = factory.block();
                const mockSigs = [
                    ethers.hexlify(ethers.randomBytes(65)),
                    ethers.hexlify(ethers.randomBytes(65))
                ];
                const getBlockStub = sinon
                    .stub(agreementManager, "getBlock")
                    .returns(mockBlockObj);
                const didEveryoneSignStub = sinon
                    .stub(agreementManager, "didEveryoneSignBlock")
                    .returns(true);
                const getSignaturesStub = sinon
                    .stub(agreementManager, "getSigantures")
                    .returns(mockSigs);

                const proof = proofManager.createFoldRechallengeProof(1, 2);

                expect(proof).to.not.be.undefined;
                expect(proof!.proofType).to.equal(ProofType.FoldRechallenge);
                expect(proof!.encodedProof).to.be.a("string");

                const decodedProof = ProofManager.decodeProof(
                    ProofType.FoldRechallenge,
                    proof!.encodedProof
                );
                expect(decodedProof.encodedBlock).to.equal(
                    EvmUtils.encodeBlock(mockBlockObj)
                );
                expect(decodedProof.signatures).to.deep.equal(mockSigs);

                getBlockStub.restore();
                didEveryoneSignStub.restore();
                getSignaturesStub.restore();
            });
        });

        describe("createDoubleSignProof", () => {
            it("should return an empty proof when no conflicting blocks are found", () => {
                const signedBlock1: SignedBlockStruct = {
                    encodedBlock: EvmUtils.encodeBlock(factory.block()),
                    signature: ethers.hexlify(ethers.randomBytes(65))
                };

                const getDoubleSignedBlockStub = sinon
                    .stub(agreementManager, "getDoubleSignedBlock")
                    .returns(undefined);

                const proof = proofManager.createDoubleSignProof([
                    signedBlock1
                ]);

                expect(proof.proofType).to.equal(ProofType.DoubleSign);
                const decodedProof = ProofManager.decodeProof(
                    ProofType.DoubleSign,
                    proof.encodedProof
                );
                expect(decodedProof.doubleSigns).to.be.an("array").that.is
                    .empty;

                getDoubleSignedBlockStub.restore();
            });

            it("should create a valid double sign proof when conflicting blocks are found", () => {
                const signedBlock1: SignedBlockStruct = {
                    encodedBlock: EvmUtils.encodeBlock(factory.block()),
                    signature: factory.signature()
                };

                const conflictingBlock: SignedBlockStruct = {
                    encodedBlock: EvmUtils.encodeBlock(
                        factory.block({
                            previousStateHash: ethers.hexlify(
                                ethers.randomBytes(32)
                            ) // Make it different
                        })
                    ),
                    signature: factory.signature()
                };

                const getDoubleSignedBlockStub = sinon
                    .stub(agreementManager, "getDoubleSignedBlock")
                    .returns(conflictingBlock);

                const proof = proofManager.createDoubleSignProof([
                    signedBlock1
                ]);

                const decodedProof = ProofManager.decodeProof(
                    ProofType.DoubleSign,
                    proof.encodedProof
                ) as DoubleSignProofStruct;
                expect(decodedProof.doubleSigns).to.have.lengthOf(1);
                expect(decodedProof.doubleSigns[0].block1).to.deep.equal(
                    signedBlock1
                );
                expect(decodedProof.doubleSigns[0].block2).to.deep.equal(
                    conflictingBlock
                );

                getDoubleSignedBlockStub.restore();
            });
        });
    });

    describe("validators", () => {
        let signers: any[];
        let signer1: Signer;
        let signer2: Signer;
        let participant1: AddressLike;
        let participant2: AddressLike;

        before(async () => {
            signers = await ethers.getSigners();
            signer1 = signers[0];
            signer2 = signers[1];
            participant1 = await signer1.getAddress();
            participant2 = await signer2.getAddress();
        });

        describe("isFoldRechallengeValid", () => {
            it("should return true when proof matches dispute parameters", () => {
                const header = factory.transactionHeader({
                    participant: participant1,
                    transactionCnt: 5
                });
                const mockBlockObj = factory.block({
                    transaction: factory.transaction({
                        header: header
                    })
                });

                const mockDispute: DisputeStruct = factory.disputeStruct({
                    foldedTransactionCnt: 5,
                    timedoutParticipant: participant1
                });

                const foldRechallengeProofStruct: FoldRechallengeProofStruct = {
                    encodedBlock: EvmUtils.encodeBlock(mockBlockObj),
                    signatures: [factory.signature(), factory.signature()]
                };

                const proof: ProofStruct = {
                    proofType: ProofType.FoldRechallenge,
                    encodedProof: ProofManager.encodeProof(
                        ProofType.FoldRechallenge,
                        foldRechallengeProofStruct
                    )!
                };

                const isValid = ProofManager.isFoldRechallengeValid(
                    proof,
                    mockDispute
                );

                expect(isValid).to.be.true;
            });

            it("should return false when transaction count does not match", () => {
                const mockBlockObj = factory.block({
                    transaction: factory.transaction({
                        header: factory.transactionHeader({
                            participant: participant1,
                            transactionCnt: 6 // Different from dispute
                        })
                    })
                });

                const mockDispute = factory.disputeStruct({
                    foldedTransactionCnt: 5,
                    timedoutParticipant: participant1
                });

                const foldRechallengeProofStruct: FoldRechallengeProofStruct = {
                    encodedBlock: EvmUtils.encodeBlock(mockBlockObj),
                    signatures: [factory.signature(), factory.signature()]
                };

                const proof: ProofStruct = {
                    proofType: ProofType.FoldRechallenge,
                    encodedProof: ProofManager.encodeProof(
                        ProofType.FoldRechallenge,
                        foldRechallengeProofStruct
                    )!
                };

                const isValid = ProofManager.isFoldRechallengeValid(
                    proof,
                    mockDispute
                );

                expect(isValid).to.be.false;
            });

            it("should return false when participant does not match", () => {
                const mockBlockObj = factory.block({
                    transaction: factory.transaction({
                        header: factory.transactionHeader({
                            participant: participant1,
                            transactionCnt: 5
                        })
                    })
                });

                const mockDispute = factory.disputeStruct({
                    foldedTransactionCnt: 5,
                    timedoutParticipant: participant2 // Different participant
                });

                const foldRechallengeProofStruct: FoldRechallengeProofStruct = {
                    encodedBlock: EvmUtils.encodeBlock(mockBlockObj),
                    signatures: [factory.signature(), factory.signature()]
                };

                const proof: ProofStruct = {
                    proofType: ProofType.FoldRechallenge,
                    encodedProof: ProofManager.encodeProof(
                        ProofType.FoldRechallenge,
                        foldRechallengeProofStruct
                    )!
                };

                const isValid = ProofManager.isFoldRechallengeValid(
                    proof,
                    mockDispute
                );

                expect(isValid).to.be.false;
            });
        });

        describe("filterValidProofs", () => {
            it("should return an empty array if no proofs are provided", () => {
                const mockDispute: DisputeStruct = factory.disputeStruct({
                    channelId: ethers.hexlify(ethers.zeroPadBytes("0x00", 32)),
                    virtualVotingBlocks: [],
                    foldedTransactionCnt: 0,
                    slashedParticipants: [],
                    timedoutParticipant: ethers.ZeroAddress
                });

                const filteredUndefined =
                    ProofManager.filterValidProofs(mockDispute);

                const filteredEmpty = ProofManager.filterValidProofs(
                    mockDispute,
                    []
                );

                expect(filteredUndefined).to.be.an("array").that.is.empty;
                expect(filteredEmpty).to.be.an("array").that.is.empty;
            });

            it("should filter out invalid proofs", () => {
                const mockDispute = factory.disputeStruct({});

                const validDoubleSignProof: ProofStruct = {
                    proofType: ProofType.DoubleSign,
                    encodedProof: "0x1234" // Content doesn't matter for this test
                };

                const invalidDoubleSignProof: ProofStruct = {
                    proofType: ProofType.DoubleSign,
                    encodedProof: "0x5678" // Content doesn't matter for this test
                };

                // Stub validation method to return true for valid proof, false for invalid
                const validatorStub = sinon.stub(
                    ProofManager,
                    "isDoubleSignValid"
                );
                validatorStub
                    .withArgs(validDoubleSignProof, mockDispute)
                    .returns(true);
                validatorStub
                    .withArgs(invalidDoubleSignProof, mockDispute)
                    .returns(false);

                const filtered = ProofManager.filterValidProofs(mockDispute, [
                    validDoubleSignProof,
                    invalidDoubleSignProof
                ]);

                expect(filtered).to.have.lengthOf(1);
                expect(filtered[0]).to.equal(validDoubleSignProof);

                // Cleanup
                validatorStub.restore();
            });

            it("should throw an error for unknown proof types", () => {
                const mockDispute: DisputeStruct = factory.disputeStruct({
                    channelId: ethers.hexlify(ethers.zeroPadBytes("0x00", 32)),
                    virtualVotingBlocks: [],
                    foldedTransactionCnt: 0,
                    slashedParticipants: [],
                    timedoutParticipant: ethers.ZeroAddress
                });

                const invalidProof: ProofStruct = {
                    proofType: 999 as any, // Invalid proof type
                    encodedProof: "0x1234"
                };

                // Act & Assert: Should throw an error
                expect(() =>
                    ProofManager.filterValidProofs(mockDispute, [invalidProof])
                ).to.throw("Unknown proof type: 999");
            });
        });
    });
});
