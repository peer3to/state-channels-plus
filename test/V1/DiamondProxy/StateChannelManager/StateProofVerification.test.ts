import { expect } from "chai";
import { ethers } from "hardhat";

import { Codec, Type } from "@/utils";
import { deployMathChannelProxyFixture } from "@test/test_utils/testHelpers";
import { StateChannelManagerInterface } from "@typechain-types";
import {
    DisputeAuditingDataStruct,
    DisputeStruct,
    MilestoneProofStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import {
    SnapshotDataStruct,
    StateSnapshotStruct
} from "@typechain-types/contracts/V1/types/DataTypes";

describe("StateChannelManagerProxy.verifyStateProof", function () {
    let mathChannelManager: StateChannelManagerInterface;

    beforeEach(async function () {
        const contracts = await deployMathChannelProxyFixture(ethers);
        mathChannelManager = contracts.mathChannelManager;
    });

    it("returns false when supplied auditing data does not match disputeAuditingDataHash", async function () {
        const { dispute, auditingData } = buildGenesisDispute();
        const mismatchedAuditingData = {
            ...auditingData,
            latestFinalizedStateStateMachineState: "0x1234"
        };

        const result = await mathChannelManager.verifyStateProof.staticCall(
            dispute,
            mismatchedAuditingData
        );

        expect(result).to.equal(false);
    });

    it("returns false instead of reverting when signedBlocks contain undecodable bytes", async function () {
        const { dispute, auditingData } = buildGenesisDispute();
        dispute.input.stateProof.signedBlocks = [buildUndecodableSignedBlock()];

        const result = await mathChannelManager.verifyStateProof.staticCall(
            dispute,
            auditingData
        );

        expect(result).to.equal(false);
    });

    it("isCorrectLatestState returns false instead of reverting when latest block is undecodable", async function () {
        const { dispute, auditingData } = buildGenesisDispute();
        dispute.input.stateProof.signedBlocks = [buildUndecodableSignedBlock()];

        const result = await mathChannelManager.isCorrectLatestState.staticCall(
            dispute,
            auditingData.genesisStateSnapshotData
        );

        expect(result).to.equal(false);
    });

    it("verifyMilestones returns false instead of reverting when a milestone block is undecodable", async function () {
        const { dispute, auditingData } = buildGenesisDispute();
        const milestone = buildUndecodableMilestoneProof();

        const result = await mathChannelManager.verifyMilestones.staticCall(
            dispute.input.forkId,
            [milestone],
            [auditingData.latestStateSnapshot],
            auditingData.latestStateSnapshot
        );

        expect(result).to.equal(false);
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
});

function buildGenesisDispute(): {
    dispute: DisputeStruct;
    auditingData: DisputeAuditingDataStruct;
} {
    const genesisStateSnapshotData = buildSnapshotData();
    const forkId = ethers.keccak256(
        Codec.encode(genesisStateSnapshotData, Type.SnapshotData)
    );
    const latestStateSnapshot: StateSnapshotStruct = {
        snapshotData: genesisStateSnapshotData,
        forkId,
        blockHeight: 0n,
        timestamp: 0n
    };
    const auditingData: DisputeAuditingDataStruct = {
        genesisStateSnapshotData,
        latestStateSnapshot,
        milestoneSnapshots: [],
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
                channelId: ethers.keccak256(
                    ethers.toUtf8Bytes("state-proof-verification")
                ),
                forkId,
                latestStateSnapshotHash,
                latestInboundMessageBlockHash: ethers.ZeroHash,
                lastInboundMessageBlockHeight: 0n,
                stateProof: {
                    milestones: [],
                    signedBlocks: []
                },
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
