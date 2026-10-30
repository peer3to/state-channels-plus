import { Bytes, Hash } from "./types";
import {
    StateSnapshotStruct,
    MessageBlockStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { DisputeConfirmationStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { StateProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";
import type { BigNumberish } from "ethers";

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
    /** the server's chain head after its last chain read: the requester judges once its own head reaches it */
    chainBlock: BigNumberish;
}
