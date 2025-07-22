import { expect } from "chai";
import { ethers } from "hardhat";
import { JsonRpcProvider, Wallet } from "ethers";
import { LocalDiamond } from "../../typechain-types";
import { deploy, deployLocalDiamond } from "../../scripts/V1/deploy";

describe("Universal Deployment", () => {
    let deployer: any;
    let config: any;
    let libraryAddress: string;
    let mathStateMachineDeployTx: any;

    before(async () => {
        [deployer] = await ethers.getSigners();

        config = {
            provider: ethers.provider as unknown as JsonRpcProvider,
            signer: deployer as unknown as Wallet,
            rpcUrl: "http://localhost:8545"
        };

        const StateChannelUtilLibrary = await ethers.getContractFactory(
            "StateChannelUtilLibrary"
        );
        const library = await StateChannelUtilLibrary.deploy();
        libraryAddress = await library.getAddress();

        // Create MathStateMachine deployment transaction
        const MathStateMachine =
            await ethers.getContractFactory("MathStateMachine");
        mathStateMachineDeployTx = {
            interface: MathStateMachine.interface,
            bytecode: MathStateMachine.bytecode,
            constructorArgs: [5000000]
        };
    });

    describe("Local Diamond", () => {
        it("deploys successfully", async () => {
            const result = await deployLocalDiamond(
                mathStateMachineDeployTx,
                config
            );

            expect(await result.diamond.getAddress()).to.not.equal(
                ethers.ZeroAddress
            );
            expect(await result.stateMachine.getAddress()).to.not.equal(
                ethers.ZeroAddress
            );
        });

        it("provides storage functionality", async () => {
            const result = await deployLocalDiamond(
                mathStateMachineDeployTx,
                config
            );
            const localDiamond = result.diamond as LocalDiamond;

            const testSlot = ethers.keccak256(ethers.toUtf8Bytes("test-slot"));
            const testValue = ethers.keccak256(
                ethers.toUtf8Bytes("test-value")
            );

            await localDiamond.setStorageSlot(testSlot, testValue);
            const retrievedValue = await localDiamond.getStorageSlot(testSlot);

            expect(retrievedValue).to.equal(testValue);
        });
    });

    describe("consumer facet Deployment", () => {
        it("deploys with consumer facet", async () => {
            const MathConsumerFacet = await ethers.getContractFactory(
                "MathConsumerFacet",
                {
                    libraries: { StateChannelUtilLibrary: libraryAddress }
                }
            );
            const consumerFacet = await MathConsumerFacet.deploy();

            const result = await deploy(
                await consumerFacet.getAddress(),
                mathStateMachineDeployTx,
                config
            );

            expect(await result.diamond.getAddress()).to.not.equal(
                ethers.ZeroAddress
            );
            expect(await result.stateMachine.getAddress()).to.not.equal(
                ethers.ZeroAddress
            );
        });

        it("supports multiple deployments", async () => {
            const MathConsumerFacet1 = await ethers.getContractFactory(
                "MathConsumerFacet",
                {
                    libraries: { StateChannelUtilLibrary: libraryAddress }
                }
            );
            const consumerFacet1 = await MathConsumerFacet1.deploy();

            const MathConsumerFacet2 = await ethers.getContractFactory(
                "MathConsumerFacet",
                {
                    libraries: { StateChannelUtilLibrary: libraryAddress }
                }
            );
            const consumerFacet2 = await MathConsumerFacet2.deploy();

            const result1 = await deploy(
                await consumerFacet1.getAddress(),
                mathStateMachineDeployTx,
                config
            );
            const result2 = await deploy(
                await consumerFacet2.getAddress(),
                mathStateMachineDeployTx,
                config
            );

            expect(await result1.diamond.getAddress()).to.not.equal(
                await result2.diamond.getAddress()
            );
            expect(await result1.stateMachine.getAddress()).to.not.equal(
                await result2.stateMachine.getAddress()
            );
        });

        it("fails with invalid consumer facet", async () => {
            const fakeAddress = "0x1234567890123456789012345678901234567890";

            const result = await deploy(
                fakeAddress,
                mathStateMachineDeployTx,
                config
            );

            const channelId = ethers.keccak256(
                ethers.toUtf8Bytes("test-channel")
            );
            const openChannelData = ["0x"];
            const signatures = ["0x"];

            await expect(
                result.diamond.openChannel(
                    channelId,
                    openChannelData,
                    signatures
                )
            ).to.be.reverted;
        });
    });
});
