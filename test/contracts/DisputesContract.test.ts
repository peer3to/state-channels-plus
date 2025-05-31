import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { deployStateChannelUtilLibrary, deployDisputeManagerFacetTest } from "@test/test_utils/testHelpers";
import { DisputeStruct, StateSnapshotStruct } from "@typechain-types/contracts/V1/StateChannelDiamondProxy/DisputeManagerFacet";
import * as factory from "../factory";
import { DisputeDataStruct} from "@typechain-types/contracts/V1/helpers/StateChannelStorageTest";
import { DisputeManagerFacetTest } from "@typechain-types/index";

describe("DisputesManagerContract", function () {
    let signer: HardhatEthersSigner;
    let disputeManagerFacet: DisputeManagerFacetTest;
    let channelId: string;
    let disputeData: DisputeDataStruct;
    let dispute: DisputeStruct;
    let stateSnapshot: StateSnapshotStruct;
    
    before(async function () {
        [signer] = await ethers.getSigners();
        const libraryUtil = await deployStateChannelUtilLibrary(ethers);
        const {disputeManagerFacetTest: facetTest} = await deployDisputeManagerFacetTest(ethers, libraryUtil.libraryUtilContractAddress);
        disputeManagerFacet = facetTest;
        channelId = ethers.keccak256(ethers.toUtf8Bytes("test-channel"));
    });

    describe("External Functions", function() {
        describe("createDispute", function() {

            before(async function() {
                channelId = ethers.keccak256(ethers.toUtf8Bytes("test-channel"));
                const latestJoinChannelBlockHash = ethers.keccak256(ethers.toUtf8Bytes("latest-join-channel-block-hash"));
                disputeData = factory.disputeData({latestJoinChannelBlockHash: latestJoinChannelBlockHash});
                dispute = factory.disputeStruct({channelId: channelId, disputer: signer.address, onChainLatestJoinChannelBlockHash: latestJoinChannelBlockHash});
                stateSnapshot = factory.stateSnapshot({participants: [signer.address]});
                await disputeManagerFacet.setDisputeData(channelId, disputeData);
                await disputeManagerFacet.setStateSnapshot(channelId, stateSnapshot);
            });

            it("should create a dispute successfully", async function() {
                const retrivedStateSnapshot = (await disputeManagerFacet.getStateSnapshot(channelId)) as StateSnapshotStruct;
                expect(retrivedStateSnapshot.participants).to.include(dispute.disputer);
                const tx = await disputeManagerFacet.connect(signer).createDispute(dispute);
                await tx.wait();    
                expect(tx).to.emit(disputeManagerFacet, "DisputeCreated").withArgs(dispute.channelId, dispute.disputeIndex);
            });

            it("should check and pass race conditions", async function() {
                
            });

            it("should check and pass timeout", async function() {
                // TODO: Implement test
            });

        });

        describe("auditDispute", function() {
            it("should audit dispute successfully", async function() {
                // TODO: Implement test
            });

            it("should revert if dispute commitment is incorrect", async function() {
                // TODO: Implement test
            });

            it("should revert if dispute is expired", async function() {
                // TODO: Implement test
            });

            it("should verify state proof correctly", async function() {
                // TODO: Implement test
            });
        });

        describe("challengeDispute", function() {
            it("should challenge dispute successfully", async function() {
                // TODO: Implement test
            });

            it("should slash disputer if audit fails", async function() {
                // TODO: Implement test
            });

            it("should slash challenger if audit succeeds", async function() {
                // TODO: Implement test
            });
        });
    });
});
