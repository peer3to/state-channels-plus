import { Bytes, Hash } from "./types";
import {
    StateSnapshotStruct,
    MessageBlockStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { StateProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";
import { DisputeConfirmationStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";

export interface DisputeWindowVerification {
    disputeConfirmations: DisputeConfirmationStruct[];
    forkId: Hash; // can deduct from disputes - don't need to include here
    latestStateSnapshot: StateSnapshotStruct;
    latestEncodedStateMachineState: Bytes;
    inboundMessageBlocksAppliedInReduce: MessageBlockStruct[];
    reducedForkId: Hash; // hint used during verification
}

export interface SyncPayload {
    disputeWindows: DisputeWindowVerification[];
    latestForkGenesisSnapshot: StateSnapshotStruct;
    latestForkGenesisEncodedState: Bytes;
    stateProof: StateProofStruct;
    milestoneSnapshots: StateSnapshotStruct[];
    latestFinalizedEncodedState: Bytes;
    outboundMessageBlocksUpToLatestGenesis: MessageBlockStruct[];
    outboundMessageBlocksOfTheLatestFork: MessageBlockStruct[];
}
