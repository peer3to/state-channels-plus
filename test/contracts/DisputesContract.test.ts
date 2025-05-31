import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { deployStateChannelUtilLibrary, deployDisputeManagerFacetTest } from "@test/test_utils/testHelpers";
import { DisputeStruct, StateSnapshotStruct } from "@typechain-types/contracts/V1/StateChannelDiamondProxy/DisputeManagerFacet";
import * as factory from "../factory";
import { DisputeDataStruct} from "@typechain-types/contracts/V1/helpers/StateChannelStorageTest";
import { DisputeManagerFacetTest } from "@typechain-types/index";
import { AbiCoder, keccak256 } from "ethers";


describe("DisputesManagerContract", function () {
    let signer: HardhatEthersSigner;
    let signer2: HardhatEthersSigner;
    let signer3: HardhatEthersSigner;
    let disputeManagerFacet: DisputeManagerFacetTest;
    let channelId: string;
    let disputeData: DisputeDataStruct;
    let dispute: DisputeStruct;
    let stateSnapshot: StateSnapshotStruct;
    let latestJoinChannelBlockHash: string;
    
    before(async function () {
        [signer, signer2, signer3] = await ethers.getSigners();
        const libraryUtil = await deployStateChannelUtilLibrary(ethers);
        const {disputeManagerFacetTest: facetTest} = await deployDisputeManagerFacetTest(ethers, libraryUtil.libraryUtilContractAddress);
        disputeManagerFacet = facetTest;
        channelId = ethers.keccak256(ethers.toUtf8Bytes("test-channel"));
        latestJoinChannelBlockHash = ethers.keccak256(ethers.toUtf8Bytes("latest-join-channel-block-hash"));
    });

    describe("DisputeHandlingTest", function() {
        describe("createDisputeFunction", function() {
            beforeEach(async function() {
                // Clear storage before each test for isolation
                await disputeManagerFacet.clearStateSnapshot(channelId);
                await disputeManagerFacet.clearDisputeData(channelId);
            });

            it("should create a dispute successfully", async function() {
                disputeData = factory.disputeData({latestJoinChannelBlockHash: latestJoinChannelBlockHash});
                dispute = factory.disputeStruct({channelId: channelId, disputer: signer.address, onChainLatestJoinChannelBlockHash: latestJoinChannelBlockHash});
                stateSnapshot = factory.stateSnapshot({participants: [signer.address]});
                await disputeManagerFacet.setDisputeData(channelId, disputeData);
                await disputeManagerFacet.setStateSnapshot(channelId, stateSnapshot);
                const tx = await disputeManagerFacet.connect(signer).createDispute(dispute);
                const txReceipt = await tx.wait();    
                const disputeComitedEventLog = txReceipt?.logs.find((log) => log.topics[0] === ethers.id("DisputeCommited(bytes,uint256)"))!;
                const event = disputeManagerFacet.interface.parseLog(disputeComitedEventLog)!;
                const disputeDataResult = await disputeManagerFacet.getDisputeData(channelId);
                const encoded = AbiCoder.defaultAbiCoder().encode(
                    ["bytes", "uint256"],
                    [event.args[0], event.args[1]]
                );
                const commitmentHash = keccak256(encoded);
                expect(disputeDataResult.disputeCommitments.length).to.equal(1);
                expect(disputeDataResult.disputeCommitments[0]).to.include(commitmentHash);
            });

            it("should fail if the disputer is not signer", async function() {
                disputeData = factory.disputeData({latestJoinChannelBlockHash: latestJoinChannelBlockHash});
                dispute = factory.disputeStruct({channelId: channelId, disputer: signer.address, onChainLatestJoinChannelBlockHash: latestJoinChannelBlockHash});
                stateSnapshot = factory.stateSnapshot({participants: [signer.address]});
                await disputeManagerFacet.setDisputeData(channelId, disputeData);
                await disputeManagerFacet.setStateSnapshot(channelId, stateSnapshot);
                await expect(
                    disputeManagerFacet.connect(signer2).createDispute(dispute)
                ).to.be.revertedWithCustomError(disputeManagerFacet, "ErrorDisputerNotMsgSender");
            });

            it("should fail if the disputer is not in the snapshot", async function() {
                disputeData = factory.disputeData({latestJoinChannelBlockHash: latestJoinChannelBlockHash});
                dispute = factory.disputeStruct({channelId: channelId, disputer: signer.address, onChainLatestJoinChannelBlockHash: latestJoinChannelBlockHash});
                stateSnapshot = factory.stateSnapshot({participants: [signer2.address]});
                await disputeManagerFacet.setDisputeData(channelId, disputeData);
                await disputeManagerFacet.setStateSnapshot(channelId, stateSnapshot);
                await expect(
                    disputeManagerFacet.connect(signer).createDispute(dispute)
                ).to.be.revertedWithCustomError(disputeManagerFacet, "ErrorCantParticipateInDispute");
            });

            it("should pass if the disputer is in pending participants", async function() {
                disputeData = factory.disputeData({pendingParticipants: [signer.address], latestJoinChannelBlockHash: latestJoinChannelBlockHash});
                dispute = factory.disputeStruct({channelId: channelId, disputer: signer.address, onChainLatestJoinChannelBlockHash: latestJoinChannelBlockHash});
                stateSnapshot = factory.stateSnapshot({participants: [signer2.address]});
                await disputeManagerFacet.setDisputeData(channelId, disputeData);
                await disputeManagerFacet.setStateSnapshot(channelId, stateSnapshot);
                const tx = await disputeManagerFacet.connect(signer).createDispute(dispute);
                await tx.wait();    
                expect(tx).to.emit(disputeManagerFacet, "DisputeCreated").withArgs(dispute.channelId, dispute.disputeIndex);
            });

            it("should fail if onChainSlashedParticipants mismatches", async function() {
                disputeData = factory.disputeData({onChainSlashedParticipants: [], latestJoinChannelBlockHash: latestJoinChannelBlockHash});
                dispute = factory.disputeStruct({channelId: channelId, disputer: signer.address, onChainLatestJoinChannelBlockHash: latestJoinChannelBlockHash, onChainSlashes: [signer2.address]});
                stateSnapshot = factory.stateSnapshot({participants: [signer.address]});
                await disputeManagerFacet.setDisputeData(channelId, disputeData);
                await disputeManagerFacet.setStateSnapshot(channelId, stateSnapshot);
                await expect(
                    disputeManagerFacet.connect(signer).createDispute(dispute)
                ).to.be.revertedWithCustomError(disputeManagerFacet, "ErrorDisputeOnChainSlashedParticipantsMismatch");
            });

            it("should fail if disputeIndex is not expected", async function() {
                disputeData = factory.disputeData({latestJoinChannelBlockHash: latestJoinChannelBlockHash, pendingParticipants: [signer.address]});
                dispute = factory.disputeStruct({channelId: channelId, disputer: signer.address, onChainLatestJoinChannelBlockHash: latestJoinChannelBlockHash, disputeIndex: 2});
                stateSnapshot = factory.stateSnapshot({participants: [signer.address]});
                await disputeManagerFacet.setDisputeData(channelId, disputeData);
                await disputeManagerFacet.setStateSnapshot(channelId, stateSnapshot);
                await expect(
                    disputeManagerFacet.connect(signer).createDispute(dispute)
                ).to.be.revertedWithCustomError(disputeManagerFacet, "ErrorDisputeNotExpectedIndex");
            });

            it("timeout should fail if block calldata commitment is found", async function() {
                stateSnapshot = factory.stateSnapshot({participants: [signer.address]});
                await disputeManagerFacet.setStateSnapshot(channelId, stateSnapshot);
                await disputeManagerFacet.setBlockCalldataCommitment(channelId, signer2.address, 0, 1, ethers.keccak256(ethers.toUtf8Bytes("block-calldata-commitment")));
                const timeout = factory.timeout({participant: signer2.address, forkCnt: 0, blockHeight: 1, isForced: false});
                dispute = factory.disputeStruct({channelId: channelId, disputer: signer.address, onChainLatestJoinChannelBlockHash: latestJoinChannelBlockHash, timeout:timeout});
                await expect(
                    disputeManagerFacet.connect(signer).createDispute(dispute)
                ).to.be.revertedWithCustomError(disputeManagerFacet, "ErrorDisputeTimeoutCalldataPosted");
            });

            it("timeout should pass if previous block producer posted calldata and the expectation match", async function() {
                stateSnapshot = factory.stateSnapshot({participants: [signer.address]});
                disputeData = factory.disputeData({latestJoinChannelBlockHash: latestJoinChannelBlockHash});
                const timeStamp = await disputeManagerFacet.getTimeStamp() + BigInt(1000);
                const timeout = factory.timeout({participant: signer2.address, forkCnt: 0, blockHeight: 2, isForced: false, previousBlockProducer: signer3.address, previousBlockProducerPostedCalldata: true, minTimeStamp: timeStamp});
                dispute = factory.disputeStruct({channelId: channelId, disputer: signer.address, onChainLatestJoinChannelBlockHash: latestJoinChannelBlockHash, timeout:timeout});
                
                await disputeManagerFacet.setDisputeData(channelId, disputeData);
                await disputeManagerFacet.setStateSnapshot(channelId, stateSnapshot);
                await disputeManagerFacet.setBlockCalldataCommitment(channelId, signer3.address, 0, 1, ethers.keccak256(ethers.toUtf8Bytes("block-calldata-commitment")));
               
                const tx = await disputeManagerFacet.connect(signer).createDispute(dispute);
                const txReceipt = await tx.wait();
                expect(txReceipt?.status).to.equal(1);
                
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
