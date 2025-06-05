import { expect } from "chai";
import sinon from "sinon";
import { ethers } from "hardhat";
import { SignedBlockStruct } from "@typechain-types/contracts/V1/DataTypes";

import DisputeHandler from "@/DisputeHandler";
import AgreementManager from "@/agreementManager";
import P2pEventHooks from "@/P2pEventHooks";
import { EvmUtils } from "@/utils/EvmUtils";
import * as factory from "../factory";
import { Codec, Type } from "@/utils";

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
            })
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
        it("should properly handle disputeDoubleSign", async () => {
            // Arrange
            const mockBlock = factory.block({
                transaction: factory.transaction({
                    header: factory.transactionHeader({ forkCnt: 0 })
                })
            });
            const signedBlock: SignedBlockStruct = {
                encodedBlock: Codec.encode(mockBlock, Type.Block),
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
                encodedBlock: Codec.encode(mockBlock, Type.Block),
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

        it("should handle onDispute correctly", async () => {});
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
        it("should update a dispute when a new challenge is issued", async () => {});
    });
});
