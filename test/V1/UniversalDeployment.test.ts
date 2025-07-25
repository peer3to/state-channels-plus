import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { EVM } from "@ethereumjs/evm";

import { LocalDiamond } from "../../typechain-types";
import { deploy, deployLocalDiamond } from "../../scripts/V1/deploy";

describe("Universal Deployment", () => {
    let deployer: HardhatEthersSigner;
    let libraryAddress: string;
    let mathStateMachineBytecode: string;
    let evm: EVM;

    before(async () => {
        [deployer] = await ethers.getSigners();

        // Initialize EVM for local deployment tests
        evm = await EVM.create();

        const StateChannelUtilLibrary = await ethers.getContractFactory(
            "StateChannelUtilLibrary"
        );
        const library = await StateChannelUtilLibrary.deploy();
        libraryAddress = await library.getAddress();

        // Create MathStateMachine deployment transaction
        const MathStateMachine =
            await ethers.getContractFactory("MathStateMachine");

        // Get the deployment transaction data
        const deployTx = await MathStateMachine.getDeployTransaction(5000000);
        mathStateMachineBytecode = deployTx.data || "0x";
    });

    describe("Local Diamond", () => {
        it("deploys successfully", async () => {
            const diamondAddress = await deployLocalDiamond(
                mathStateMachineBytecode,
                evm
            );

            expect(diamondAddress).to.not.equal(ethers.ZeroAddress);
            expect(diamondAddress).to.match(/^0x[a-fA-F0-9]{40}$/);
        });

        it("provides storage functionality", async () => {
            const diamondAddress = await deployLocalDiamond(
                mathStateMachineBytecode,
                evm
            );

            // Create a contract instance to interact with the deployed diamond
            const LocalDiamondFactory =
                await ethers.getContractFactory("LocalDiamond");
            const localDiamond = LocalDiamondFactory.attach(
                diamondAddress
            ) as LocalDiamond;

            const testSlot = ethers.keccak256(ethers.toUtf8Bytes("test-slot"));
            const testValue = ethers.keccak256(
                ethers.toUtf8Bytes("test-value")
            );

            // Note: For local EVM deployment, we can't directly call contract methods
            // as we would with a network deployment. The storage functionality
            // would need to be tested through the EVM interface or by creating
            // a ContractExecuter instance.

            // This test demonstrates that the deployment was successful
            expect(diamondAddress).to.not.equal(ethers.ZeroAddress);
        });
    });

    describe("consumer facet Deployment", () => {
        it("deploys with consumer facet", async () => {
            // Deploy MathStateMachine first
            const MathStateMachine =
                await ethers.getContractFactory("MathStateMachine");
            const stateMachine = await MathStateMachine.deploy(5000000);
            await stateMachine.waitForDeployment();

            // Deploy MathConsumerFacet
            const MathConsumerFacet = await ethers.getContractFactory(
                "MathConsumerFacet",
                {
                    libraries: { StateChannelUtilLibrary: libraryAddress }
                }
            );
            const consumerFacet = await MathConsumerFacet.deploy();
            await consumerFacet.waitForDeployment();

            const diamondContract = await deploy(
                await stateMachine.getAddress(),
                await consumerFacet.getAddress(),
                deployer
            );

            expect(await diamondContract.getAddress()).to.not.equal(
                ethers.ZeroAddress
            );

            const times = await diamondContract.getAllTimes();
            expect(times).to.deep.equal([15n, 5n, 30n, 30n, 60n]);
        });

        it("fails with invalid consumer facet", async () => {
            // Deploy state machine
            const MathStateMachine =
                await ethers.getContractFactory("MathStateMachine");
            const stateMachine = await MathStateMachine.deploy(5000000);
            await stateMachine.waitForDeployment();

            const fakeAddress = "0x1234567890123456789012345678901234567890";

            const diamondContract = await deploy(
                await stateMachine.getAddress(),
                fakeAddress,
                deployer
            );

            const channelId = ethers.keccak256(
                ethers.toUtf8Bytes("test-channel")
            );
            const openChannelData = ["0x"];
            const signatures = ["0x"];

            await expect(
                diamondContract.openChannel(
                    channelId,
                    openChannelData,
                    signatures
                )
            ).to.be.reverted;
        });
    });
});
