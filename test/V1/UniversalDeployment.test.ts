import { expect } from "chai";
import { ethers } from "hardhat";
import { JsonRpcProvider, Wallet } from "ethers";
import { LocalDiamond } from "../../typechain-types";
import { deployUniversal } from "../../scripts/V1/deployUniversal";

describe("Universal Deployment System - Simplified", () => {
    let deployer: any;
    let config: any;

    before(async () => {
        [deployer] = await ethers.getSigners();

        // Create deployment config using hardhat provider and signer
        config = {
            provider: ethers.provider as unknown as JsonRpcProvider,
            signer: deployer as unknown as Wallet,
            rpcUrl: "http://localhost:8545"
        };
    });

    describe("LocalDiamond with ZeroAddress", () => {
        it("should deploy with ZeroAddress consumer facet", async () => {
            // This is the simplest possible test - deploy with ZeroAddress
            const result = await deployUniversal(ethers.ZeroAddress, config);

            expect(await result.diamond.getAddress()).to.not.equal(
                ethers.ZeroAddress
            );
            expect(await result.stateMachine.getAddress()).to.not.equal(
                ethers.ZeroAddress
            );
        });

        it("should provide LocalDiamond functionality", async () => {
            const result = await deployUniversal(ethers.ZeroAddress, config);
            const localDiamond = result.diamond as LocalDiamond;

            // Test storage functionality
            const testSlot = ethers.keccak256(ethers.toUtf8Bytes("test-slot"));
            const testValue = ethers.keccak256(
                ethers.toUtf8Bytes("test-value")
            );

            await localDiamond.setStorageSlot(testSlot, testValue);
            const retrievedValue = await localDiamond.getStorageSlot(testSlot);

            expect(retrievedValue).to.equal(testValue);
        });

        it("should handle dispute game functionality", async () => {
            const result = await deployUniversal(ethers.ZeroAddress, config);
            const diamond = result.diamond;

            // Test basic channel functionality
            const channelId = ethers.keccak256(
                ethers.toUtf8Bytes("test-channel")
            );
            expect(await diamond.isChannelOpen(channelId)).to.be.false;
        });
    });
});
