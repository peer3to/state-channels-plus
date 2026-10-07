import Block from "@/models/Block";
import StateSnapshot from "@/models/StateSnapshot";
import type { Bytes } from "@/types/types";
import { Codec, SignatureUtils, Type } from "@/utils";
import {
    createOpenChannelTestObject,
    deployMathChannelProxyFixture,
    getSigners
} from "@test/test_utils/testHelpers";
import { StateChannelManagerInterface } from "@typechain-types";
import {
    SnapshotDataStruct,
    StateSnapshotStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import type { DisputeInvalidStateProofStruct } from "@typechain-types/contracts/V1/types/DisputeFraudProofTypes";
import {
    DisputeAuditingDataStruct,
    DisputeStruct,
    MilestoneProofStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import { expect } from "chai";
import { ethers } from "hardhat";

describe("StateChannelManagerProxy state-proof views", function () {
    let mathChannelManager: StateChannelManagerInterface;

    beforeEach(async function () {
        const contracts = await deployMathChannelProxyFixture(ethers);
        mathChannelManager = contracts.mathChannelManager;
    });

    it("isStateProofStepInvalid rejects a challenge whose posted auditing data does not match disputeAuditingDataHash", async function () {
        const { dispute, auditingData } = buildGenesisDispute([
            buildUndecodableMilestoneProof()
        ]);
        const mismatchedAuditingData = {
            ...auditingData,
            latestFinalizedStateStateMachineState: "0x1234"
        };

        const result =
            await mathChannelManager.isStateProofStepInvalid.staticCall(
                dispute,
                buildStepChallenge(mismatchedAuditingData)
            );

        expect(result).to.equal(false);
    });

    it("isStateProofStepInvalid judges a milestone block with undecodable bytes invalid instead of reverting", async function () {
        const { dispute, auditingData } = buildGenesisDispute([
            buildUndecodableMilestoneProof()
        ]);

        const result =
            await mathChannelManager.isStateProofStepInvalid.staticCall(
                dispute,
                buildStepChallenge(auditingData)
            );

        expect(result).to.equal(true);
    });

    it("isCorrectLatestState returns false instead of reverting when latest block is undecodable", async function () {
        const { dispute, auditingData } = buildGenesisDispute([
            buildUndecodableMilestoneProof()
        ]);

        const result = await mathChannelManager.isCorrectLatestState.staticCall(
            dispute,
            auditingData.genesisStateSnapshotData
        );

        expect(result).to.equal(false);
    });

    it("verifyMilestones returns false instead of reverting when a milestone block is undecodable", async function () {
        const { dispute, auditingData } = buildGenesisDispute([
            buildUndecodableMilestoneProof()
        ]);

        const result = await mathChannelManager.verifyMilestones.staticCall({
            channelId: dispute.input.channelId,
            forkId: dispute.input.forkId,
            stateProof: dispute.input.stateProof,
            genesisStateSnapshotData: auditingData.genesisStateSnapshotData,
            milestoneSnapshots: auditingData.milestoneSnapshots
        });

        expect(result.valid).to.equal(false);
        expect(result.snapshotMismatch).to.equal(false);
    });

    it("isMilestoneFinal returns false instead of reverting when a milestone block is undecodable", async function () {
        const { dispute, auditingData } = buildGenesisDispute();
        const result = await mathChannelManager.isMilestoneFinal.staticCall(
            dispute.input.forkId,
            auditingData.genesisStateSnapshotData,
            buildUndecodableMilestoneProof()
        );

        expect(result[0]).to.equal(false);
        expect(result[1]).to.equal(ethers.ZeroHash);
    });

    // Controls: the same views on a decodable proof (an opened channel's
    // genesis-linked block 0 signed by its author) return the opposite
    // verdict, so the results above come from the undecodable bytes.
    it("control: isStateProofStepInvalid finds no fault in the same step when its block decodes", async function () {
        const { dispute, auditingData } =
            await openChannelWithBlockZeroDispute(mathChannelManager);

        const result =
            await mathChannelManager.isStateProofStepInvalid.staticCall(
                dispute,
                buildStepChallenge(auditingData)
            );

        expect(result).to.equal(false);
    });

    it("control: isCorrectLatestState returns true when the latest block decodes and commits the latest state", async function () {
        const { dispute, auditingData } =
            await openChannelWithBlockZeroDispute(mathChannelManager);

        const result = await mathChannelManager.isCorrectLatestState.staticCall(
            dispute,
            auditingData.genesisStateSnapshotData
        );

        expect(result).to.equal(true);
    });

    it("control: verifyMilestones accepts the proof when its block decodes", async function () {
        const { dispute, auditingData } =
            await openChannelWithBlockZeroDispute(mathChannelManager);

        const result = await mathChannelManager.verifyMilestones.staticCall({
            channelId: dispute.input.channelId,
            forkId: dispute.input.forkId,
            stateProof: dispute.input.stateProof,
            genesisStateSnapshotData: auditingData.genesisStateSnapshotData,
            milestoneSnapshots: auditingData.milestoneSnapshots
        });

        expect(result.valid).to.equal(true);
        expect(result.snapshotMismatch).to.equal(false);
    });

    it("control: isMilestoneFinal finalizes the milestone when its block decodes and its signer is the whole threshold set", async function () {
        const { dispute, auditingData, author } =
            await openChannelWithBlockZeroDispute(mathChannelManager);
        const milestone = dispute.input.stateProof.milestones[0];

        const result = await mathChannelManager.isMilestoneFinal.staticCall(
            dispute.input.forkId,
            {
                ...auditingData.genesisStateSnapshotData,
                participants: [author]
            },
            milestone
        );

        expect(result[0]).to.equal(true);
        expect(result[1]).to.equal(dispute.input.latestStateSnapshotHash);
    });
});

/**
 * Opens a two-participant channel on `manager` and builds a posted-data
 * dispute whose one milestone is the genesis-linked block 0, decodable and
 * signed by its author, committing the dispute's latest state.
 */
async function openChannelWithBlockZeroDispute(
    manager: StateChannelManagerInterface
): Promise<{
    dispute: DisputeStruct;
    auditingData: DisputeAuditingDataStruct;
    author: string;
}> {
    const { firstSigner, secondSigner } = await getSigners(ethers);
    const openChannel = createOpenChannelTestObject(
        [firstSigner.address, secondSigner.address],
        { channelId: "state-proof-verification-control" }
    );
    const opened = await SignatureUtils.signOpenChannel(
        openChannel,
        firstSigner
    );
    const confirmed = await SignatureUtils.signOpenChannel(
        openChannel,
        secondSigner
    );
    await (
        await manager.open({
            encodedOpenChannel: opened.encoded,
            signatures: [opened.signature, confirmed.signature] as Bytes[]
        })
    ).wait();
    const channelId = String(openChannel.channelId);
    // the view returns an ethers Result: a spread keeps only its index keys,
    // so it is re-decoded into a plain struct before it is copied
    const genesisStruct = Codec.decode(
        Codec.encode(
            await manager.getStateSnapshot(channelId),
            Type.StateSnapshot
        ),
        Type.StateSnapshot
    );
    const genesis = StateSnapshot.from(genesisStruct);
    // any snapshot other than the genesis: the walk only matches its hash
    const latestStateSnapshot: StateSnapshotStruct = {
        ...genesisStruct,
        timestamp: BigInt(genesisStruct.timestamp) + 1n
    };
    const blockZero = await Block.fromBlockStruct(
        {
            transaction: {
                header: {
                    channelId,
                    participant: firstSigner.address,
                    forkId: genesisStruct.forkId,
                    transactionCnt: 0n,
                    timestamp: BigInt(genesisStruct.timestamp)
                },
                body: { encodedData: "0x", data: "0x" }
            },
            stateSnapshotHash: StateSnapshot.from(latestStateSnapshot).hash,
            previousBlockHash: genesis.hash,
            messageBlocks: []
        },
        firstSigner
    );
    return {
        ...buildPostedDispute({
            channelId,
            forkId: String(genesisStruct.forkId),
            genesisStateSnapshotData: genesisStruct.snapshotData,
            latestStateSnapshot,
            milestones: [
                { blockConfirmations: [blockZero.blockConfirmationStruct] }
            ]
        }),
        author: firstSigner.address
    };
}

function buildGenesisDispute(milestones: MilestoneProofStruct[] = []): {
    dispute: DisputeStruct;
    auditingData: DisputeAuditingDataStruct;
} {
    const genesisStateSnapshotData = buildSnapshotData();
    const forkId = ethers.keccak256(
        Codec.encode(genesisStateSnapshotData, Type.SnapshotData)
    );
    return buildPostedDispute({
        channelId: ethers.keccak256(
            ethers.toUtf8Bytes("state-proof-verification")
        ),
        forkId,
        genesisStateSnapshotData,
        latestStateSnapshot: {
            snapshotData: genesisStateSnapshotData,
            forkId,
            blockHeight: 0n,
            timestamp: 0n
        },
        milestones
    });
}

/** A dispute with posted auditing data: one supplied snapshot per milestone, each the latest state. */
function buildPostedDispute(options: {
    channelId: string;
    forkId: string;
    genesisStateSnapshotData: SnapshotDataStruct;
    latestStateSnapshot: StateSnapshotStruct;
    milestones: MilestoneProofStruct[];
}): {
    dispute: DisputeStruct;
    auditingData: DisputeAuditingDataStruct;
} {
    const { channelId, forkId, latestStateSnapshot, milestones } = options;
    const auditingData: DisputeAuditingDataStruct = {
        genesisStateSnapshotData: options.genesisStateSnapshotData,
        latestStateSnapshot,
        // one supplied snapshot per milestone, so the walk judges the blocks and not the evidence count
        milestoneSnapshots: milestones.map(() => latestStateSnapshot),
        latestFinalizedStateStateMachineState: "0x",
        inboundMessageBlocks: [],
        outboundMessageBlocks: []
    };
    const disputeAuditingDataHash = ethers.keccak256(
        Codec.encode(auditingData, Type.DisputeAuditingData)
    );
    const latestStateSnapshotHash = ethers.keccak256(
        Codec.encode(latestStateSnapshot, Type.StateSnapshot)
    );

    return {
        auditingData,
        dispute: {
            input: {
                channelId,
                forkId,
                latestStateSnapshotHash,
                latestInboundMessageBlockHash: ethers.ZeroHash,
                lastInboundMessageBlockHeight: 0n,
                stateProof: { milestones },
                onChainSlashes: [],
                disputeAuditingDataHash,
                disputer: ethers.ZeroAddress,
                timeout: {
                    participant: ethers.ZeroAddress,
                    blockHeight: 0n,
                    minTimeStamp: 0n,
                    isForced: false,
                    previousBlockProducer: ethers.ZeroAddress,
                    previousBlockProducerPostedCalldata: false,
                    participantSignatureOnPreviousBlock: "0x"
                },
                requireExistingDisputeWindow: false,
                selfRemoval: false
            },
            postedAuditingData: true,
            outputSnapshotDataHash: ethers.ZeroHash
        }
    };
}

/** The invalid-state-proof challenge pointed at milestone 0 with the committed `auditingData`. */
function buildStepChallenge(
    auditingData: DisputeAuditingDataStruct
): DisputeInvalidStateProofStruct {
    return {
        milestoneIndex: 0n,
        hasBlockIndex: false,
        blockIndex: 0n,
        auditingData,
        previousStateSnapshot: auditingData.latestStateSnapshot,
        resultingStateSnapshot: auditingData.latestStateSnapshot
    };
}

function buildSnapshotData(): SnapshotDataStruct {
    return {
        originForkId: ethers.ZeroHash,
        stateMachineStateHash: ethers.ZeroHash,
        participants: [],
        latestInboundMessageBlockHash: ethers.ZeroHash,
        latestInboundMessageBlockHeight: 0n,
        latestOutboundMessageBlockHash: ethers.ZeroHash,
        latestOutboundMessageBlockHeight: 0n,
        totalDeposits: {
            amount: 0n,
            data: "0x"
        },
        totalWithdrawals: {
            amount: 0n,
            data: "0x"
        }
    };
}

function buildUndecodableSignedBlock() {
    return {
        encodedBlock: "0x1234",
        signature: "0x"
    };
}

function buildUndecodableMilestoneProof(): MilestoneProofStruct {
    return {
        blockConfirmations: [
            {
                signedBlock: buildUndecodableSignedBlock(),
                signatures: []
            }
        ]
    };
}
