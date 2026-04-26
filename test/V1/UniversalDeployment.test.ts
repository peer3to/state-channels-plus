import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import {
    deploy,
    deployLocalDiamond,
    deployArtifact,
    createLocalDeployerFromTx
} from "../../scripts/V1/deploy";
import MathStateMachineArtifact from "../../artifacts/contracts/V1/examples/MathStateMachine/MathStateMachine.sol/MathStateMachine.json";
import MathConsumerFacetArtifact from "../../artifacts/contracts/V1/examples/MathStateMachine/MathConsumerFacet.sol/MathConsumerFacet.json";
import { EVM } from "@ethereumjs/evm";
import { OpenChannelConfirmationStruct } from "@typechain-types/contracts/V1/StateChannelManagerInterface";

describe("Universal Deployment", () => {
    let deployer: HardhatEthersSigner;
    let mathStateMachineDeployTx: any;
    let evm: EVM;

    before(async () => {
        evm = await EVM.create({ allowUnlimitedContractSize: true });
        [deployer] = await ethers.getSigners();

        const MathStateMachine =
            await ethers.getContractFactory("MathStateMachine");

        mathStateMachineDeployTx =
            await MathStateMachine.getDeployTransaction(5000000);
    });

    describe("Local Diamond", () => {
        it("wraps a deploy tx as a local deployer", async () => {
            const deployerFn = createLocalDeployerFromTx(
                mathStateMachineDeployTx
            );
            const deployedAddress = await deployerFn(evm, deployer);

            expect(deployedAddress.toString()).to.not.equal(ethers.ZeroAddress);
            expect(deployedAddress.toString()).to.match(/^0x[a-fA-F0-9]{40}$/);
        });

        it("deploys successfully", async () => {
            const deployerFn = createLocalDeployerFromTx(
                mathStateMachineDeployTx
            );
            const { address: diamondAddress } = await deployLocalDiamond(
                deployerFn,
                evm,
                deployer
            );

            expect(diamondAddress).to.not.equal(ethers.ZeroAddress);
            expect(diamondAddress).to.match(/^0x[a-fA-F0-9]{40}$/);
        });
    });

    describe("consumer facet Deployment", () => {
        let mathStateMachineAddress: string;
        let consumerFacetAddress: string;

        before(async () => {
            const { address: mathAddress } = await deployArtifact(
                MathStateMachineArtifact,
                deployer,
                {
                    args: [5000000]
                }
            );
            mathStateMachineAddress = mathAddress;

            const { address: consumerAddress } = await deployArtifact(
                MathConsumerFacetArtifact,
                deployer
            );
            consumerFacetAddress = consumerAddress;
        });
        it("deploys with consumer facet", async () => {
            const { address: diamondAddress, contract: diamondContract } =
                await deploy(
                    mathStateMachineAddress,
                    consumerFacetAddress,
                    deployer
                );

            expect(diamondAddress).to.not.equal(ethers.ZeroAddress);

            const times = await diamondContract.getAllTimes();
            expect(times).to.deep.equal([15n, 5n, 30n, 30n]);
        });

        it("fails with invalid consumer facet", async () => {
            const fakeConsumerFacetAddress =
                "0x1234567890123456789012345678901234567890";

            const { contract: diamondContract } = await deploy(
                mathStateMachineAddress,
                fakeConsumerFacetAddress,
                deployer
            );

            const openChannelData = ["0x"];
            const signatures = ["0x"];
            const openChannelConfirmation: OpenChannelConfirmationStruct = {
                encodedOpenChannel: ethers.toUtf8Bytes(
                    JSON.stringify(openChannelData)
                ),
                signatures: signatures
            };

            await expect(diamondContract.open(openChannelConfirmation)).to.be
                .reverted;
        });
    });
});
