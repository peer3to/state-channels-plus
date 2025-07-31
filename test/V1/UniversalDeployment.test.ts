import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import {
    deploy,
    deployLocalDiamond,
    linkLibraries,
    deployArtifact
} from "../../scripts/V1/deploy";
import DisputeFraudProofFacetArtifact from "../../artifacts/contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol/DisputeFraudProofFacet.json";
import MathStateMachineArtifact from "../../artifacts/contracts/V1/examples/MathStateMachine/MathStateMachine.sol/MathStateMachine.json";
import MathConsumerFacetArtifact from "../../artifacts/contracts/V1/examples/MathStateMachine/MathConsumerFacet.sol/MathConsumerFacet.json";
import StateChannelUtilLibraryArtifact from "../../artifacts/contracts/V1/StateChannelDiamondProxy/StateChannelUtilLibrary.sol/StateChannelUtilLibrary.json";
import { EVM } from "@ethereumjs/evm";

describe("Universal Deployment", () => {
    let deployer: HardhatEthersSigner;
    let libraryAddress: string;
    let mathStateMachineDeployTx: any;
    let evm: EVM;

    before(async () => {
        // TEMPORARY: allow unlimited contract size
        // DisputeManagerFacet is too large to deploy with the default code size limit
        // TODO: https://trello.com/c/8472PdJp
        evm = await EVM.create({
            allowUnlimitedContractSize: true
        });
        [deployer] = await ethers.getSigners();

        const { address } = await deployArtifact(
            StateChannelUtilLibraryArtifact,
            deployer
        );
        libraryAddress = address;

        const MathStateMachine =
            await ethers.getContractFactory("MathStateMachine");

        mathStateMachineDeployTx =
            await MathStateMachine.getDeployTransaction(5000000);
    });

    describe("Local Diamond", () => {
        it("deploys successfully", async () => {
            const { address: diamondAddress } = await deployLocalDiamond(
                mathStateMachineDeployTx,
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
                deployer,
                {
                    libs: { StateChannelUtilLibrary: libraryAddress }
                }
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
            expect(times).to.deep.equal([15n, 5n, 30n, 30n, 60n]);
        });

        it("fails with invalid consumer facet", async () => {
            const fakeConsumerFacetAddress =
                "0x1234567890123456789012345678901234567890";

            const { contract: diamondContract } = await deploy(
                mathStateMachineAddress,
                fakeConsumerFacetAddress,
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

    describe("linkLibraries function", () => {
        it("should replace library placeholders with addresses", () => {
            const libraryAddress = "0x5FbDB2315678afecb367f032d93F642f64180aa3";

            const linkedArtifact = linkLibraries(
                DisputeFraudProofFacetArtifact,
                { StateChannelUtilLibrary: libraryAddress }
            );

            // Assert that placeholders are replaced (should find 0 placeholders)
            const placeholderPattern = /__\$[a-fA-F0-9]+\$__/g;
            const placeholderMatches =
                linkedArtifact.bytecode.match(placeholderPattern);
            expect(placeholderMatches).to.be.null;

            // Assert that the library address appears the expected number of times (2 times based on linkReferences)
            const normalizedAddress = libraryAddress
                .toLowerCase()
                .replace(/^0x/, "")
                .padStart(40, "0");
            const addressMatches = linkedArtifact.bytecode.match(
                new RegExp(normalizedAddress, "g")
            );
            const expectedLength =
                DisputeFraudProofFacetArtifact.linkReferences[
                    "contracts/V1/StateChannelDiamondProxy/StateChannelUtilLibrary.sol"
                ].StateChannelUtilLibrary.length;
            expect(addressMatches).to.have.length(expectedLength);
        });

        it("should throw error when library address is missing", () => {
            expect(() => {
                linkLibraries(DisputeFraudProofFacetArtifact, {});
            }).to.throw(
                "Missing deployed address for library 'StateChannelUtilLibrary'"
            );
        });
    });
});
