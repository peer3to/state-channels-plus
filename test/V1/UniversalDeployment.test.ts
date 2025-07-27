import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { Signer } from "ethers";

import { deploy, deployLocalDiamond } from "../../scripts/V1/deploy";

describe("Universal Deployment", () => {
    let deployer: HardhatEthersSigner;
    let libraryAddress: string;
    let mathStateMachineDeployTx: any;

    before(async () => {
        [deployer] = await ethers.getSigners();

        const StateChannelUtilLibrary = await ethers.getContractFactory(
            "StateChannelUtilLibrary"
        );
        const library = await StateChannelUtilLibrary.deploy();
        libraryAddress = await library.getAddress();

        // Create MathStateMachine deployment transaction
        const MathStateMachine =
            await ethers.getContractFactory("MathStateMachine");

        // Get the deployment transaction
        mathStateMachineDeployTx =
            await MathStateMachine.getDeployTransaction(5000000);
    });

    // describe("Local Diamond", () => {
    //     it("deploys successfully", async () => {
    //         const { address: diamondAddress } = await deployLocalDiamond(
    //             mathStateMachineDeployTx,
    //             localSigner
    //         );

    //         expect(diamondAddress).to.not.equal(ethers.ZeroAddress);
    //         expect(diamondAddress).to.match(/^0x[a-fA-F0-9]{40}$/);
    //     });

    //     it("provides storage functionality", async () => {
    //         const { address: diamondAddress, contract: localDiamond } = await deployLocalDiamond(
    //             mathStateMachineDeployTx,
    //             localSigner
    //         );

    //         const testSlot = ethers.keccak256(ethers.toUtf8Bytes("test-slot"));
    //         const testValue = ethers.keccak256(
    //             ethers.toUtf8Bytes("test-value")
    //         );

    //         // Note: For local EVM deployment, we can't directly call contract methods
    //         // as we would with a network deployment. The storage functionality
    //         // would need to be tested through the EVM interface or by creating
    //         // a ContractExecuter instance.

    //         // This test demonstrates that the deployment was successful
    //         expect(diamondAddress).to.not.equal(ethers.ZeroAddress);
    //         const response = await localDiamond.setStorageSlot(testSlot, testValue)
    //         expect(response).to.not.equal(ethers.ZeroAddress);
    //         expect(await localDiamond.getStorageSlot(testSlot)).to.equal(testValue);
    //     });
    // });

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

            const { address: diamondAddress, contract: diamondContract } =
                await deploy(
                    await stateMachine.getAddress(),
                    await consumerFacet.getAddress(),
                    deployer
                );

            expect(diamondAddress).to.not.equal(ethers.ZeroAddress);

            const times = await diamondContract.getAllTimes();
            expect(times).to.deep.equal([15n, 5n, 30n, 30n, 60n]);
        });

        // it("fails with invalid consumer facet", async () => {
        //     // Deploy state machine
        //     const MathStateMachine =
        //         await ethers.getContractFactory("MathStateMachine");
        //     const stateMachine = await MathStateMachine.deploy(5000000);
        //     await stateMachine.waitForDeployment();

        //     const fakeAddress = "0x1234567890123456789012345678901234567890";

        //     const {  contract: diamondContract } = await deploy(
        //         await stateMachine.getAddress(),
        //         fakeAddress,
        //         deployer
        //     );

        //     const channelId = ethers.keccak256(
        //         ethers.toUtf8Bytes("test-channel")
        //     );
        //     const openChannelData = ["0x"];
        //     const signatures = ["0x"];

        //     await expect(
        //         diamondContract.openChannel(
        //             channelId,
        //             openChannelData,
        //             signatures
        //         )
        //     ).to.be.reverted;
        // });
    });
});
