import MathConsumerFacetArtifact from "../../artifacts/contracts/V1/examples/MathStateMachine/MathConsumerFacet.sol/MathConsumerFacet.json";
import MathStateMachineArtifact from "../../artifacts/contracts/V1/examples/MathStateMachine/MathStateMachine.sol/MathStateMachine.json";
import LocalDiamondArtifact from "../../artifacts/contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol/LocalDiamond.json";
import { DEFAULT_MAX_CHANNEL_PARTICIPANTS } from "../../scripts/V1/deploy";
import {
    deploy,
    deployLocalDiamond,
    deployArtifact
} from "../../scripts/V1/deploy";
import LocalContractExecutorSigner from "@/evm/signer/LocalContractExecutorSigner";
import { ContractSizeLimitError } from "@/index";
import { StateSnapshot } from "@/models";
import { Codec, SignatureUtils, Type } from "@/utils";
import { connectLocalDiamond } from "@/utils/localDiamond";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import * as factory from "@test/factory";
import {
    createSdkOwnedExecutor,
    disposeSdkExecutorFixtures
} from "@test/fixtures/node/SdkExecutorFixture";
import {
    authorOnlyRun,
    snapshotAt,
    walkChannelGenesis,
    walkInput,
    walkResultProjection
} from "@test/fixtures/StateProofWalkStaging";
import {
    createJoinChannelTestObject,
    createOpenChannelTestObject
} from "@test/test_utils/testHelpers";
import { OpenChannelConfirmationStruct } from "@typechain-types/contracts/V1/StateChannelManagerInterface";
import { expect } from "chai";
import { ContractFactory, type Signer } from "ethers";
import { ethers } from "hardhat";

describe("Universal Deployment", () => {
    after(disposeSdkExecutorFixtures);
    let deployer: HardhatEthersSigner;
    let localSigner: LocalContractExecutorSigner;

    const deployMathStateMachineLocally = async (signer: Signer) => {
        const factory = new ContractFactory(
            MathStateMachineArtifact.abi,
            MathStateMachineArtifact.bytecode,
            signer
        );
        const response = await signer.sendTransaction(
            await factory.getDeployTransaction(
                5000000,
                DEFAULT_MAX_CHANNEL_PARTICIPANTS
            )
        );
        const receipt = await response.wait();
        if (!receipt?.contractAddress) {
            throw new Error(
                "No local MathStateMachine contract address created"
            );
        }
        return receipt.contractAddress;
    };

    const deployLocalMirror = async () =>
        connectLocalDiamond(
            (
                await deployLocalDiamond(
                    deployMathStateMachineLocally,
                    localSigner,
                    undefined,
                    12_000_000
                )
            ).address.toString(),
            localSigner
        );

    before(async () => {
        [deployer] = await ethers.getSigners();
        localSigner = new LocalContractExecutorSigner(
            deployer,
            await createSdkOwnedExecutor({ dedicatedThread: false })
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
            const contract = await deployLocalMirror();
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

        it("refuses older same-fork, origin-fork and absent snapshot logs", async () => {
            const contract = await deployLocalMirror();
            const channelId = ethers.id("local-diamond-snapshot-order");
            const forkId = ethers.id("local-diamond-snapshot-fork-a");
            const atHeight8 = factory.stateSnapshot({ forkId, blockHeight: 8 });
            const newFork = factory.stateSnapshot({
                forkId: ethers.id("local-diamond-snapshot-fork-b"),
                blockHeight: 0,
                snapshotData: { originForkId: forkId }
            });
            const mirrored = async () =>
                StateSnapshot.from(await contract.getStateSnapshot(channelId))
                    .hash;

            // a trusted (0, 0) reconciliation does not advance the event coordinate
            await contract.onStateSnapshotUpdated(
                channelId,
                atHeight8.toStruct(),
                0,
                0
            );
            await contract.onStateSnapshotUpdated(
                channelId,
                factory.stateSnapshot({ forkId, blockHeight: 6 }).toStruct(),
                11,
                1
            );
            expect(await mirrored(), "older same-fork log").to.equal(
                atHeight8.hash
            );

            await contract.onStateSnapshotUpdated(
                channelId,
                newFork.toStruct(),
                0,
                0
            );
            expect(await mirrored(), "a new fork is accepted").to.equal(
                newFork.hash
            );
            await contract.onStateSnapshotUpdated(
                channelId,
                factory.stateSnapshot({ forkId, blockHeight: 9 }).toStruct(),
                12,
                1
            );
            await contract.onStateSnapshotUpdated(
                channelId,
                factory.stateSnapshot({ forkId: ethers.ZeroHash }).toStruct(),
                0,
                0
            );
            expect(await mirrored(), "origin-fork and absent logs").to.equal(
                newFork.hash
            );
        });

        it("a same-fork snapshot log at the stored height replaces the stored snapshot", async () => {
            const contract = await deployLocalMirror();
            const channelId = ethers.id("local-diamond-snapshot-same-height");
            const forkId = ethers.id("local-diamond-snapshot-same-height-fork");
            const first = factory.stateSnapshot({ forkId, blockHeight: 8 });
            const replacement = factory.stateSnapshot({
                forkId,
                blockHeight: 8
            });
            expect(replacement.hash).to.not.equal(first.hash);
            const mirrored = async () =>
                StateSnapshot.from(await contract.getStateSnapshot(channelId))
                    .hash;

            await contract.onStateSnapshotUpdated(
                channelId,
                first.toStruct(),
                10,
                1
            );
            await contract.onStateSnapshotUpdated(
                channelId,
                replacement.toStruct(),
                11,
                1
            );

            expect(await mirrored()).to.equal(replacement.hash);
        });

        it("local supplied start does not mutate mirror", async () => {
            const contract = await deployLocalMirror();
            const author = ethers.Wallet.createRandom();
            const channel = walkChannelGenesis(
                "local-supplied-start",
                [author.address, ethers.Wallet.createRandom().address],
                1_000n
            );
            const mirrored = snapshotAt(channel.genesis, 5n);
            await contract.onStateSnapshotUpdated(
                channel.channelId,
                mirrored,
                10,
                1
            );
            // a trusted point at 8 commits the run's first block; only its author signed it
            const chosen = snapshotAt(channel.genesis, 8n);
            const input = walkInput(
                channel,
                [await authorOnlyRun(channel, author, [8n, 9n])],
                [chosen]
            );

            expect(
                walkResultProjection(
                    await contract.verifyMilestonesFromTrustedStart.staticCall(
                        input,
                        chosen,
                        true
                    )
                )
            ).to.deep.equal({
                valid: true,
                finalizedSnapshotHash: StateSnapshot.from(chosen).hash,
                replayBlockIndex: 1n
            });
            expect(
                (await contract.verifyMilestones(input)).valid,
                "from the mirrored start the point at 8 lacks its threshold"
            ).to.equal(false);
            await contract.verifyMilestonesFromTrustedStart(
                input,
                chosen,
                true
            );
            expect(
                StateSnapshot.from(
                    await contract.getStateSnapshot(channel.channelId)
                ).hash
            ).to.equal(StateSnapshot.from(mirrored).hash);
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
                    args: [5000000, DEFAULT_MAX_CHANNEL_PARTICIPANTS]
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
            // the deadline passed to postBlockCalldata was one second before the
            // latest block, so the chain reverted with exactly that comparison
            expect(proxyError?.args.maxTimestamp).to.equal(
                BigInt(currentBlock!.timestamp - 1)
            );
            expect(Number(proxyError?.args.currentTimestamp)).to.be.greaterThan(
                Number(proxyError?.args.maxTimestamp)
            );

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

            const invalidSubmitterJoin = createJoinChannelTestObject(
                secondSigner.address
            );
            let routedFacetFailure: any;
            try {
                await diamondContract.joinChannel(
                    {
                        signedJoinChannel: {
                            encodedJoinChannel: Codec.encode(
                                invalidSubmitterJoin,
                                Type.JoinChannel
                            ),
                            signature: "0x"
                        },
                        signatures: []
                    },
                    ethers.ZeroHash,
                    ethers.ZeroHash
                );
            } catch (error) {
                routedFacetFailure = error;
            }
            const routedFacetError = diamondContract.interface.parseError(
                routedFacetFailure.data
            );
            expect(routedFacetError?.name).to.equal(
                "ErrorJoinChannelInvalidSubmitter"
            );
            expect(routedFacetError?.args[0]).to.equal(secondSigner.address);
            expect(routedFacetError?.args[1]).to.equal(deployer.address);
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
