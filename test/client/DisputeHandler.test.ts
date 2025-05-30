import { expect } from "chai";
import sinon from "sinon";
import { ethers } from "hardhat";
import { SignedBlockStruct } from "@typechain-types/contracts/V1/DataTypes";

import DisputeHandler from "@/DisputeHandler";
import AgreementManager from "@/agreementManager";
import P2pEventHooks from "@/P2pEventHooks";
import { EvmUtils } from "@/utils/EvmUtils";
import * as factory from "../factory";

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
        it("should properly handle disputeDoubleSign", async () => {});
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
        it("should throw error when no dispute is created", async () => {});
    });

    describe("Integration behavior", () => {
        it("should update a dispute when a new challenge is issued", async () => {});
    });
});
