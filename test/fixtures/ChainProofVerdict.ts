// @spec-test-coverage-ignore: chain verdict on a dispute's state proof, shared by the proof-construction and audit tests
import StateSnapshot from "@/models/StateSnapshot";
import { Codec, hash, Type } from "@/utils";
import type { StateChannelManagerInterface } from "@typechain-types";
import type {
    DisputeAuditingDataStruct,
    DisputeStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";

/**
 * Whether the chain accepts `dispute`'s state proof with `auditingData`, from
 * its live views: the data is the dispute's commitment, the posted latest
 * snapshot is the dispute's, the full walk from the chain's start
 * (`verifyMilestones`) is valid, and the proof's latest state is the
 * dispute's (`isCorrectLatestState`).
 */
export async function chainAcceptsDisputeProof(
    contract: StateChannelManagerInterface,
    dispute: DisputeStruct,
    auditingData: DisputeAuditingDataStruct
): Promise<boolean> {
    if (
        hash(Codec.encode(auditingData, Type.DisputeAuditingData)) !==
        dispute.input.disputeAuditingDataHash
    )
        return false;
    if (
        StateSnapshot.from(auditingData.latestStateSnapshot).hash !==
        dispute.input.latestStateSnapshotHash
    )
        return false;
    const walk = await contract.verifyMilestones.staticCall({
        channelId: dispute.input.channelId,
        forkId: dispute.input.forkId,
        stateProof: dispute.input.stateProof,
        genesisStateSnapshotData: auditingData.genesisStateSnapshotData,
        milestoneSnapshots: auditingData.milestoneSnapshots
    });
    if (!walk.valid) return false;
    return contract.isCorrectLatestState.staticCall(
        dispute,
        auditingData.genesisStateSnapshotData
    );
}
