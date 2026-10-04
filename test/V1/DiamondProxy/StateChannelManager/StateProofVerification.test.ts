import { StateSnapshot } from "@/models";
import { Codec, Type } from "@/utils";
import * as factory from "@test/factory";
import { deployMathChannelProxyFixture } from "@test/test_utils/testHelpers";
import { StateChannelManagerInterface } from "@typechain-types";
import { StateSnapshotStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import {
    DisputeAuditingDataStruct,
    DisputeStruct,
    MilestoneProofStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import { expect } from "chai";
import { ethers } from "hardhat";

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

    it("isCorrectLatestState returns false instead of reverting when latest block is undecodable", async function () {
        const { dispute, auditingData } = buildGenesisDispute();
        dispute.input.stateProof.milestones = [UNDECODABLE_MILESTONE];

        const result = await mathChannelManager.isCorrectLatestState.staticCall(
            dispute,
            auditingData.genesisStateSnapshotData
        );

        expect(result).to.equal(false);
    });

    it("verifyMilestones returns false instead of reverting when a milestone block is undecodable", async function () {
        const { dispute, auditingData } = buildGenesisDispute();

        const result = await mathChannelManager.verifyMilestones.staticCall({
            channelId: dispute.input.channelId,
            forkId: dispute.input.forkId,
            stateProof: { milestones: [UNDECODABLE_MILESTONE] },
            genesisStateSnapshotData: auditingData.genesisStateSnapshotData,
            milestoneSnapshots: [auditingData.latestStateSnapshot]
        });

        expect(result.valid).to.equal(false);
    });

    it("isMilestoneFinal returns false instead of reverting when a milestone block is undecodable", async function () {
        const { dispute, auditingData } = buildGenesisDispute();
        const result = await mathChannelManager.isMilestoneFinal.staticCall(
            dispute.input.forkId,
            auditingData.genesisStateSnapshotData,
            UNDECODABLE_MILESTONE
        );

        expect(result[0]).to.equal(false);
        expect(result[1]).to.equal(ethers.ZeroHash);
    });

    it("routes getAnchorSnapshot, verifyMilestones and isStateProofLinked through the proxy", async function () {
        const { dispute, auditingData } = buildGenesisDispute();
        const { channelId, forkId } = dispute.input;
        const stateProof = { milestones: [] };
        const genesisStateSnapshotData = auditingData.genesisStateSnapshotData;

        const [canUseOnChainSnapshot, onChainSnapshot] =
            await mathChannelManager.getAnchorSnapshot(channelId, forkId);
        expect(canUseOnChainSnapshot).to.equal(false);
        expect(onChainSnapshot.forkId).to.equal(ethers.ZeroHash);
        // the empty proof is the fork genesis, undated since no channel holds it
        const result = await mathChannelManager.verifyMilestones({
            channelId,
            forkId,
            stateProof,
            genesisStateSnapshotData,
            milestoneSnapshots: []
        });
        expect(result.valid).to.equal(true);
        expect(StateSnapshot.from(result.finalizedSnapshot).hash).to.equal(
            dispute.input.latestStateSnapshotHash
        );
        expect(
            await mathChannelManager.isStateProofLinked(
                channelId,
                forkId,
                stateProof,
                genesisStateSnapshotData
            )
        ).to.equal(true);
    });
});

function buildGenesisDispute(): {
    dispute: DisputeStruct;
    auditingData: DisputeAuditingDataStruct;
} {
    const genesisStateSnapshotData = factory.snapshotData();
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
    const dispute = factory.dispute({
        input: {
            channelId: ethers.id("state-proof-verification"),
            forkId,
            latestStateSnapshotHash:
                StateSnapshot.from(latestStateSnapshot).hash,
            latestInboundMessageBlockHash: ethers.ZeroHash,
            disputeAuditingDataHash: ethers.keccak256(
                Codec.encode(auditingData, Type.DisputeAuditingData)
            )
        },
        postedAuditingData: true
    });
    return { dispute, auditingData };
}

/** A milestone whose one block does not decode. */
const UNDECODABLE_MILESTONE: MilestoneProofStruct = {
    blockConfirmations: [
        {
            signedBlock: { encodedBlock: "0x1234", signature: "0x" },
            signatures: []
        }
    ]
};
