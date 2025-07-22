import { expect } from "chai";
import { ethers } from "hardhat";
import {
    AStateChannelManagerProxy,
    MathConsumerFacet,
    LocalDiamond,
    AStateMachine
} from "../../typechain-types";
import {
    deployUniversal,
    createDeploymentConfig
} from "../../scripts/V1/deployUniversal";

describe("Universal Deployment System", () => {
    let deployer: any;
    let user1: any;
    let user2: any;
    let deploymentConfig: any;

    beforeEach(async () => {
        [deployer, user1, user2] = await ethers.getSigners();

        // Create deployment config for testing
        const provider = ethers.provider;
        deploymentConfig = {
            provider,
            signer: deployer,
            rpcUrl: "http://localhost:8545" // Hardhat default
        };
    });

    describe("Consumer Facet Pattern", () => {
        let mathConsumerFacet: MathConsumerFacet;
        let diamond: AStateChannelManagerProxy;
        let stateMachine: AStateMachine;

        beforeEach(async () => {
            // Deploy Math system using universal pattern
            const MathConsumerFacetFactory =
                await ethers.getContractFactory("MathConsumerFacet");
            mathConsumerFacet = await MathConsumerFacetFactory.deploy();
            await mathConsumerFacet.waitForDeployment();

            const result = await deployUniversal(
                await mathConsumerFacet.getAddress(),
                deploymentConfig
            );
            diamond = result.diamond;
            stateMachine = result.stateMachine;
        });

        it("should deploy all contracts successfully", async () => {
            expect(await diamond.getAddress()).to.not.equal(ethers.ZeroAddress);
            expect(await mathConsumerFacet.getAddress()).to.not.equal(
                ethers.ZeroAddress
            );
            expect(await stateMachine.getAddress()).to.not.equal(
                ethers.ZeroAddress
            );
        });

        it("should allow diamond to delegate to consumer facet", async () => {
            // Create test data for opening a channel
            const channelId = ethers.keccak256(
                ethers.toUtf8Bytes("test-channel")
            );
            const participant = user1.address;
            const balance = { amount: ethers.parseEther("1"), data: "0x" };
            const deadlineTimestamp = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

            const joinChannel = {
                channelId,
                participant,
                deadlineTimestamp,
                balance
            };

            const openChannelData = [
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ["tuple(bytes32,address,uint256,tuple(uint256,bytes))"],
                    [
                        [
                            joinChannel.channelId,
                            joinChannel.participant,
                            joinChannel.deadlineTimestamp,
                            joinChannel.balance
                        ]
                    ]
                )
            ];

            // Sign the data
            const signature = await user1.signMessage(
                ethers.getBytes(openChannelData[0])
            );
            const signatures = [signature];

            // This should work because the diamond delegates to the consumer facet
            await expect(
                diamond.openChannel(channelId, openChannelData, signatures)
            ).to.not.be.reverted;
        });

        it("should prevent opening the same channel twice", async () => {
            const channelId = ethers.keccak256(
                ethers.toUtf8Bytes("test-channel")
            );
            const participant = user1.address;
            const balance = { amount: ethers.parseEther("1"), data: "0x" };
            const deadlineTimestamp = Math.floor(Date.now() / 1000) + 3600;

            const joinChannel = {
                channelId,
                participant,
                deadlineTimestamp,
                balance
            };

            const openChannelData = [
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ["tuple(bytes32,address,uint256,tuple(uint256,bytes))"],
                    [
                        [
                            joinChannel.channelId,
                            joinChannel.participant,
                            joinChannel.deadlineTimestamp,
                            joinChannel.balance
                        ]
                    ]
                )
            ];

            const signature = await user1.signMessage(
                ethers.getBytes(openChannelData[0])
            );
            const signatures = [signature];

            // First call should succeed
            await diamond.openChannel(channelId, openChannelData, signatures);

            // Second call should fail
            await expect(
                diamond.openChannel(channelId, openChannelData, signatures)
            ).to.be.revertedWith(
                "AStateChannelManagerProxy: openChannel - channel already open"
            );
        });

        it("should handle asset management through consumer facet", async () => {
            const joinChannel = {
                channelId: ethers.keccak256(ethers.toUtf8Bytes("test")),
                participant: user1.address,
                deadlineTimestamp: Math.floor(Date.now() / 1000) + 3600,
                balance: { amount: ethers.parseEther("1"), data: "0x" }
            };

            // This should work because the diamond delegates to consumer facet
            const result = await diamond.depositAssetsComposable(joinChannel);
            expect(result).to.be.true;
        });
    });

    describe("LocalDiamond for Testing", () => {
        let localDiamond: LocalDiamond;
        let stateMachine: AStateMachine;

        beforeEach(async () => {
            // Use deployUniversal with 0x00 for local testing
            const result = await deployUniversal(
                ethers.ZeroAddress,
                deploymentConfig
            );
            localDiamond = result.diamond as LocalDiamond;
            stateMachine = result.stateMachine;
        });

        it("should deploy LocalDiamond with address(0) consumer facet", async () => {
            expect(await localDiamond.getAddress()).to.not.equal(
                ethers.ZeroAddress
            );
            expect(await stateMachine.getAddress()).to.not.equal(
                ethers.ZeroAddress
            );
        });

        it("should provide storage sync functionality", async () => {
            const testSlot = ethers.keccak256(ethers.toUtf8Bytes("test-slot"));
            const testValue = ethers.keccak256(
                ethers.toUtf8Bytes("test-value")
            );

            // Set storage
            await localDiamond.setStorageSlot(testSlot, testValue);

            // Get storage
            const retrievedValue = await localDiamond.getStorageSlot(testSlot);
            expect(retrievedValue).to.equal(testValue);
        });

        it("should handle multiple storage operations", async () => {
            const slots = [
                ethers.keccak256(ethers.toUtf8Bytes("slot1")),
                ethers.keccak256(ethers.toUtf8Bytes("slot2")),
                ethers.keccak256(ethers.toUtf8Bytes("slot3"))
            ];
            const values = [
                ethers.keccak256(ethers.toUtf8Bytes("value1")),
                ethers.keccak256(ethers.toUtf8Bytes("value2")),
                ethers.keccak256(ethers.toUtf8Bytes("value3"))
            ];

            // Set multiple slots
            await localDiamond.setStorageSlots(slots, values);

            // Get multiple slots
            const retrievedValues = await localDiamond.getStorageSlots(slots);
            expect(retrievedValues).to.deep.equal(values);
        });

        it("should focus on dispute game functionality", async () => {
            // Test that LocalDiamond can handle dispute-related operations
            // This is the main purpose - dispute game, not asset management

            // Test that it can execute state transitions (dispute game functionality)
            const channelId = ethers.keccak256(
                ethers.toUtf8Bytes("test-channel")
            );
            const encodedState = ethers.toUtf8Bytes("test-state");
            const transaction = {
                header: {
                    channelId,
                    participant: user1.address,
                    forkId: ethers.keccak256(ethers.toUtf8Bytes("fork1")),
                    transactionCnt: 1,
                    timestamp: Math.floor(Date.now() / 1000)
                },
                body: {
                    encodedData: ethers.toUtf8Bytes("test-data"),
                    data: "0x"
                }
            };

            // This should work because LocalDiamond inherits dispute game functionality
            await expect(
                localDiamond.executeStateTransition(
                    channelId,
                    encodedState,
                    transaction
                )
            ).to.not.be.reverted;
        });
    });

    describe("Universal Deployment Functions", () => {
        it("should deploy with any consumer facet address", async () => {
            // Deploy a mock consumer facet
            const MockConsumerFacet =
                await ethers.getContractFactory("MathConsumerFacet");
            const mockConsumerFacet = await MockConsumerFacet.deploy();
            await mockConsumerFacet.waitForDeployment();

            // Deploy universal system with the mock consumer facet
            const result = await deployUniversal(
                await mockConsumerFacet.getAddress(),
                deploymentConfig
            );

            expect(await result.diamond.getAddress()).to.not.equal(
                ethers.ZeroAddress
            );
            expect(await result.stateMachine.getAddress()).to.not.equal(
                ethers.ZeroAddress
            );
        });

        it("should deploy complete Math system using universal pattern", async () => {
            // Deploy consumer facet first
            const MathConsumerFacetFactory =
                await ethers.getContractFactory("MathConsumerFacet");
            const consumerFacet = await MathConsumerFacetFactory.deploy();
            await consumerFacet.waitForDeployment();

            // Deploy universal system
            const result = await deployUniversal(
                await consumerFacet.getAddress(),
                deploymentConfig
            );

            expect(await result.diamond.getAddress()).to.not.equal(
                ethers.ZeroAddress
            );
            expect(await result.stateMachine.getAddress()).to.not.equal(
                ethers.ZeroAddress
            );
        });

        it("should deploy complete Local system", async () => {
            const result = await deployUniversal(
                ethers.ZeroAddress,
                deploymentConfig
            );

            expect(await result.diamond.getAddress()).to.not.equal(
                ethers.ZeroAddress
            );
            expect(await result.stateMachine.getAddress()).to.not.equal(
                ethers.ZeroAddress
            );
        });
    });

    describe("Integration Tests", () => {
        it("should allow different consumer facets to be swapped", async () => {
            // Deploy two different consumer facets
            const MathConsumerFacetFactory =
                await ethers.getContractFactory("MathConsumerFacet");
            const consumerFacet1 = await MathConsumerFacetFactory.deploy();
            await consumerFacet1.waitForDeployment();

            const consumerFacet2 = await MathConsumerFacetFactory.deploy();
            await consumerFacet2.waitForDeployment();

            // Deploy two diamonds with different consumer facets
            const result1 = await deployUniversal(
                await consumerFacet1.getAddress(),
                deploymentConfig
            );
            const result2 = await deployUniversal(
                await consumerFacet2.getAddress(),
                deploymentConfig
            );

            expect(await result1.diamond.getAddress()).to.not.equal(
                await result2.diamond.getAddress()
            );
        });

        it("should maintain separation of concerns", async () => {
            // Test that the diamond handles dispute game logic
            // while consumer facet handles asset management logic

            const MathConsumerFacetFactory =
                await ethers.getContractFactory("MathConsumerFacet");
            const consumerFacet = await MathConsumerFacetFactory.deploy();
            await consumerFacet.waitForDeployment();

            const result = await deployUniversal(
                await consumerFacet.getAddress(),
                deploymentConfig
            );
            const diamond = result.diamond;

            // Diamond should handle dispute-related operations
            const channelId = ethers.keccak256(
                ethers.toUtf8Bytes("test-channel")
            );
            expect(await diamond.isChannelOpen(channelId)).to.be.false;

            // Consumer facet should handle asset management
            const joinChannel = {
                channelId: ethers.keccak256(ethers.toUtf8Bytes("test")),
                participant: user1.address,
                deadlineTimestamp: Math.floor(Date.now() / 1000) + 3600,
                balance: { amount: ethers.parseEther("1"), data: "0x" }
            };

            const depositResult =
                await consumerFacet.depositAssetsComposable(joinChannel);
            expect(depositResult).to.be.true;
        });
    });
});
