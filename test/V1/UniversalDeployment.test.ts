import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ContractFactory, type Signer } from "ethers";

import {
    deploy,
    deployLocalDiamond,
    deployArtifact
} from "../../scripts/V1/deploy";
import MathStateMachineArtifact from "../../artifacts/contracts/V1/examples/MathStateMachine/MathStateMachine.sol/MathStateMachine.json";
import MathConsumerFacetArtifact from "../../artifacts/contracts/V1/examples/MathStateMachine/MathConsumerFacet.sol/MathConsumerFacet.json";
import LocalDiamondArtifact from "../../artifacts/contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol/LocalDiamond.json";
import { OpenChannelConfirmationStruct } from "@typechain-types/contracts/V1/StateChannelManagerInterface";
import { createContractExecutorFactory } from "@/evm";
import LocalContractExecutorSigner from "@/evm/signer/LocalContractExecutorSigner";
import { connectLocalDiamond } from "@/utils/localDiamond";
import * as factory from "@test/factory";
import { ContractSizeLimitError } from "@/utils/contractSize";
import { createOpenChannelTestObject } from "@test/test_utils/testHelpers";
import { SignatureUtils } from "@/utils";

describe("Universal Deployment", () => {
    let deployer: HardhatEthersSigner;
    let localSigner: LocalContractExecutorSigner;

    const deployMathStateMachineLocally = async (signer: Signer) => {
        const factory = new ContractFactory(
            MathStateMachineArtifact.abi,
            MathStateMachineArtifact.bytecode,
            signer
        );
        const response = await signer.sendTransaction(
            await factory.getDeployTransaction(5000000)
        );
        const receipt = await response.wait();
        if (!receipt?.contractAddress) {
            throw new Error(
                "No local MathStateMachine contract address created"
            );
        }
        return receipt.contractAddress;
    };

    before(async () => {
        [deployer] = await ethers.getSigners();
        localSigner = new LocalContractExecutorSigner(
            deployer,
            await createContractExecutorFactory({ dedicatedThread: false })
        );
    });

    describe("Local Diamond", () => {
        it("deploys a local state machine directly with the signer", async () => {
            const deployedAddress =
                await deployMathStateMachineLocally(localSigner);

            expect(deployedAddress.toString()).to.not.equal(ethers.ZeroAddress);
            expect(deployedAddress.toString()).to.match(/^0x[a-fA-F0-9]{40}$/);
        });

        it("rejects the real oversized LocalDiamond before submitting a production deployment", async () => {
            const nonceBefore = await deployer.getNonce();
            let failure: unknown;
            try {
                await deployArtifact(LocalDiamondArtifact, deployer, {
                    args: [
                        ...Array.from({ length: 9 }, () => deployer.address),
                        0,
                        0,
                        0,
                        0,
                        0
                    ]
                });
            } catch (error) {
                failure = error;
            }

            expect(failure).to.be.instanceOf(ContractSizeLimitError);
            const sizeError = failure as ContractSizeLimitError;
            expect(sizeError.contractName).to.equal("LocalDiamond");
            expect(sizeError.measuredBytes).to.be.greaterThan(
                sizeError.limitBytes
            );
            expect(sizeError.limitBytes).to.equal(24_576);
            expect(sizeError.excessBytes).to.equal(
                sizeError.measuredBytes - sizeError.limitBytes
            );
            expect(await deployer.getNonce()).to.equal(nonceBefore);
        });

        it("deploys the oversized LocalDiamond through the exempt local path", async () => {
            const { address: diamondAddress } = await deployLocalDiamond(
                deployMathStateMachineLocally,
                localSigner,
                undefined,
                12_000_000
            );

            expect(diamondAddress).to.not.equal(ethers.ZeroAddress);
            expect(diamondAddress).to.match(/^0x[a-fA-F0-9]{40}$/);
            const diamond = connectLocalDiamond(
                diamondAddress.toString(),
                localSigner
            );
            expect(await diamond.getP2pTime()).to.equal(15n);
        });

        it("ignores stale overwrite events and deduplicates on-chain slashes", async () => {
            const { address } = await deployLocalDiamond(
                deployMathStateMachineLocally,
                localSigner,
                undefined,
                12_000_000
            );
            const contract = connectLocalDiamond(
                address.toString(),
                localSigner
            );
            const channelId = ethers.id("local-diamond-event-ordering");
            const participant = deployer.address;

            await contract.onWithdrawalsUpdated(
                channelId,
                { amount: 20n, data: "0x" },
                20,
                1
            );
            await contract.onWithdrawalsUpdated(
                channelId,
                { amount: 10n, data: "0x" },
                10,
                1
            );
            expect(
                (await contract.getChannelBalance(channelId)).totalWithdrawals
                    .amount
            ).to.equal(20n);

            await contract.onChannelStorageCleared(
                channelId,
                ethers.ZeroHash,
                30,
                1
            );
            await contract.onOnChainSlashAdded(channelId, participant, 31);
            await contract.onOnChainSlashAdded(channelId, participant, 32);
            await contract.onChannelStorageCleared(
                channelId,
                ethers.ZeroHash,
                25,
                1
            );
            expect(
                await contract.getOnChainSlashedParticipants(channelId)
            ).to.deep.equal([participant]);

            const forkId = ethers.id("duplicate-dispute-fork");
            const committedDispute = factory.dispute({
                input: { channelId, forkId, disputer: participant }
            });
            await contract.onDisputeCommitted(
                channelId,
                committedDispute,
                100,
                false,
                90
            );
            await contract.onDisputeCommitted(
                channelId,
                committedDispute,
                50,
                false,
                40
            );
            const [window] = await contract.getDisputeWindows(channelId, [
                forkId
            ]);
            expect(window.evidence.disputeCommitments).to.have.length(1);
            expect(window.evidence.hasPosted).to.deep.equal([participant]);
            expect(window.evidence.lastEvidenceSubmissionTimestamp).to.equal(
                100n
            );
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
            expect(await diamondContract.getGasLimit()).to.equal(3_000_000n);
        });

        it("deploys with a custom dispute execution gas limit", async () => {
            const { contract: diamondContract } = await deploy(
                mathStateMachineAddress,
                consumerFacetAddress,
                deployer,
                undefined,
                12_000_000
            );

            expect(await diamondContract.getGasLimit()).to.equal(12_000_000n);
        });

        it("parses proxy and facet custom errors through the returned binding", async () => {
            const { contract: diamondContract } = await deploy(
                mathStateMachineAddress,
                consumerFacetAddress,
                deployer
            );

            const currentBlock = await ethers.provider.getBlock("latest");
            const signedBlock = factory.signedBlock(undefined, deployer);
            let proxyFailure: any;
            try {
                await diamondContract.postBlockCalldata(
                    signedBlock,
                    currentBlock!.timestamp - 1
                );
            } catch (error) {
                proxyFailure = error;
            }
            const proxyError = diamondContract.interface.parseError(
                proxyFailure.data
            );
            expect(proxyError?.name).to.equal(
                "RaceConditionBlockCalldataTimestampTooLate"
            );
            expect(proxyError?.args).to.have.length(0);

            const [, secondSigner] = await ethers.getSigners();
            const openChannel = createOpenChannelTestObject([
                deployer.address,
                secondSigner.address
            ]);
            const firstSignature = await SignatureUtils.signOpenChannel(
                openChannel,
                deployer
            );
            const secondSignature = await SignatureUtils.signOpenChannel(
                openChannel,
                secondSigner
            );
            const invalidSignature = `${ethers.Signature.from(firstSignature.signature).serialized}00`;
            const validSignature = ethers.Signature.from(
                secondSignature.signature
            ).serialized;
            let facetFailure: any;
            try {
                await diamondContract.open({
                    encodedOpenChannel: firstSignature.encoded,
                    signatures: [invalidSignature, validSignature]
                });
            } catch (error) {
                facetFailure = error;
            }
            const facetError = diamondContract.interface.parseError(
                facetFailure.data
            );
            expect(facetError?.name).to.equal("ECDSAInvalidSignatureLength");
            expect(facetError?.args[0]).to.equal(66n);
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
