import { expect } from "chai";
import sinon from "sinon";
import { ethers } from "hardhat";
import { SignedBlockStruct } from "@typechain-types/contracts/V1/DataTypes";

import DisputeHandler from "@/DisputeHandler";
import AgreementManager from "@/agreementManager";
import P2pEventHooks from "@/P2pEventHooks";
import EvmUtils from "@/utils/EvmUtils";
import * as factory from "./factory";

describe("DisputeHandler", () => {
    let disputeHandler: DisputeHandler;
    let agreementManager: AgreementManager;
    let stateChannelManagerContract: any;
    let p2pEventHooks: P2pEventHooks;
    let signer: any;
    let signerAddress: string;
    let channelId: string;

    beforeEach(async () => {
        // Set up the environment for each test
        signer = await ethers.getSigners().then((signers) => signers[0]);
        signerAddress = await signer.getAddress();
        channelId = ethers.hexlify(ethers.randomBytes(32));
        agreementManager = factory.agreementManager([signerAddress]);

        // Mock contract methods
        stateChannelManagerContract = {
            createDispute: sinon.stub().returns({
                hash: "0x123",
                wait: sinon.stub().resolves({ status: 1 })
            }),
            challengeDispute: sinon.stub().returns({
                hash: "0x123",
                wait: sinon.stub().resolves({ status: 1 })
            }),
            getDispute: sinon.stub().returns(
                factory.disputeStruct({
                    channelId,
                    forkCnt: 0,
                    challengeCnt: 1
                })
            )
        };

        // Mock p2p event hooks
        p2pEventHooks = {
            onInitiatingDispute: sinon.stub()
        };

        // Create the dispute handler
        disputeHandler = new DisputeHandler(
            channelId,
            signer,
            signerAddress,
            agreementManager,
            stateChannelManagerContract,
            p2pEventHooks
        );
    });

    afterEach(() => {
        sinon.restore(); // Restore all stubs
    });

    describe("Core dispute creation methods", () => {
        it("should properly handle disputeFoldRechallenge", async () => {
            // Arrange
            const forkCnt = 0;
            const transactionCnt = 1;
            const mockProof = { proofType: 0, encodedProof: "0x123" };
            sinon
                .stub(disputeHandler.proofManager, "createFoldRechallengeProof")
                .returns(mockProof);
            const createDisputeStub = sinon
                .stub(disputeHandler, "createDispute")
                .resolves();

            // Act
            await disputeHandler.disputeFoldRechallenge(
                forkCnt,
                transactionCnt
            );

            // Assert
            expect(createDisputeStub.calledOnce).to.be.true;
            expect(createDisputeStub.firstCall.args[0]).to.equal(forkCnt);
        });

        it("should properly handle disputeDoubleSign", async () => {
            // Arrange
            const mockBlock = factory.block({
                transaction: factory.transaction({
                    header: factory.transactionHeader({ forkCnt: 0 })
                })
            });
            const signedBlock: SignedBlockStruct = {
                encodedBlock: EvmUtils.encodeBlock(mockBlock),
                signature: factory.signature()
            };

            sinon
                .stub(disputeHandler.proofManager, "createDoubleSignProof")
                .returns({ proofType: 1, encodedProof: "0x123" });
            const createDisputeStub = sinon
                .stub(disputeHandler, "createDispute")
                .resolves();

            // Act
            await disputeHandler.disputeDoubleSign([signedBlock]);

            // Assert
            expect(createDisputeStub.calledOnce).to.be.true;
        });

        it("should properly handle disputeIncorrectData", async () => {
            // Arrange
            const mockBlock = factory.block({
                transaction: factory.transaction({
                    header: factory.transactionHeader({ forkCnt: 0 })
                })
            });
            const signedBlock: SignedBlockStruct = {
                encodedBlock: EvmUtils.encodeBlock(mockBlock),
                signature: factory.signature()
            };

            sinon
                .stub(disputeHandler.proofManager, "createIncorrectDataProof")
                .returns({ proofType: 2, encodedProof: "0x123" });
            const createDisputeStub = sinon
                .stub(disputeHandler, "createDispute")
                .resolves();

            // Act
            await disputeHandler.disputeIncorrectData(signedBlock);

            // Assert
            expect(createDisputeStub.calledOnce).to.be.true;
        });
    });

    describe("Dispute management", () => {
        it("should mark a fork as disputed", () => {
            const forkCnt = 2;

            disputeHandler.setForkDisputed(forkCnt);

            expect(disputeHandler.isForkDisputed(forkCnt)).to.be.true;
            expect(disputeHandler.isForkDisputed(3)).to.be.false; // Different fork
        });

        it("should handle onDispute correctly", async () => {
            const mockDispute = factory.disputeStruct({
                forkCnt: 2,
                challengeCnt: 1
            });

            const setForkDisputedSpy = sinon.spy(
                disputeHandler,
                "setForkDisputed"
            );

            // Mock internal methods
            sinon
                .stub(disputeHandler as any, "rechallengeRecursive")
                .resolves();

            await disputeHandler.onDispute(mockDispute);

            expect(setForkDisputedSpy.calledWith(2)).to.be.true;
        });
    });

    describe("createDispute", () => {
        it("should throw error when no dispute is created", async () => {
            const forkCnt = 0;

            // Make getDispute return an invalid dispute (zero hash)
            stateChannelManagerContract.getDispute = sinon.stub().resolves({
                channelId: ethers.ZeroHash
            });

            await expect(
                disputeHandler.createDispute(forkCnt, "0x00", 0, [])
            ).to.be.rejectedWith(
                "DisputeHandler - createDispute - no dispute created"
            );
        });
    });

    describe("Integration behavior", () => {
        it("should update a dispute when a new challenge is issued", async () => {
            // Set up test disputes
            const initialDispute = factory.disputeStruct({
                channelId,
                forkCnt: 1,
                challengeCnt: 1,
                virtualVotingBlocks: [],
                postedStateDisputer: signerAddress
            });

            // Stub rechallengeRecursive to avoid the actual implementation
            const rechallengeRecursiveStub = sinon.stub(
                disputeHandler,
                "rechallengeRecursive" as any
            );
            rechallengeRecursiveStub.resolves();

            // Call the method that would call rechallengeRecursive
            await disputeHandler.onDispute(initialDispute);

            // Verify rechallengeRecursive was called
            expect(rechallengeRecursiveStub.calledWith(initialDispute)).to.be
                .true;
        });

        it("rechallengeRecursive should handle dispute challenges correctly", async () => {
            // Create a new DisputeHandler instance for this test
            const testDisputeHandler = new DisputeHandler(
                channelId,
                signer,
                signerAddress,
                agreementManager,
                stateChannelManagerContract,
                p2pEventHooks
            );

            // Access private method for testing
            const rechallengeRecursive =
                testDisputeHandler["rechallengeRecursive"].bind(
                    testDisputeHandler
                );

            // Create disputes for the test
            const initialDispute = factory.disputeStruct({
                channelId,
                forkCnt: 1,
                challengeCnt: 1,
                virtualVotingBlocks: [],
                postedStateDisputer: signerAddress
            });

            const updatedDispute = factory.disputeStruct({
                channelId,
                forkCnt: 1,
                challengeCnt: 2,
                virtualVotingBlocks: [],
                postedStateDisputer: signerAddress
            });

            // Mock updateDisputeIfNewer to return true (dispute is newer)
            sinon
                .stub(testDisputeHandler as any, "updateDisputeIfNewer")
                .returns(true);

            // Create proof for testing
            const mockProof = { proofType: 3, encodedProof: "0x456" };

            // Mock extractProofs to return our proof
            sinon
                .stub(testDisputeHandler as any, "extractProofs")
                .returns([mockProof]);

            // Mock agreementManager.getFinalizedAndLatestWithVotes
            sinon
                .stub(agreementManager, "getFinalizedAndLatestWithVotes")
                .returns({
                    encodedLatestFinalizedState: "0xfinal",
                    encodedLatestCorrectState: "0xcorrect",
                    virtualVotingBlocks: []
                });

            // Set up contract responses
            stateChannelManagerContract.challengeDispute.returns({
                hash: "0x456",
                wait: sinon.stub().resolves({ status: 1 })
            });

            stateChannelManagerContract.getDispute.returns(updatedDispute);

            // Mock the recursive call to prevent infinite recursion in test
            sinon
                .stub(testDisputeHandler as any, "rechallengeRecursive")
                .callsFake(async function (dispute: any) {
                    if (dispute.challengeCnt > 1) {
                        return; // End recursion for disputes with higher challenge count
                    }
                    // Call the original method for the first call
                    return rechallengeRecursive(dispute);
                });

            // Execute the method
            await rechallengeRecursive(initialDispute);

            // Verify contract methods were called
            expect(stateChannelManagerContract.challengeDispute.calledOnce).to
                .be.true;
            expect(stateChannelManagerContract.getDispute.calledOnce).to.be
                .true;
        });
    });
});
