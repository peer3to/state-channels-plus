import { AddressLike, BytesLike } from "ethers";
import {
    SignedBlockStruct,
    BlockConfirmationStruct,
    StateSnapshotStruct
} from "@typechain-types/contracts/V1/DataTypes";
import { ForkProofStruct } from "@typechain-types/contracts/V1/DisputeTypes";
// A fork is created by a DLT by disputing someone or asking the DLT to enforce a state.
// The user initiating the process submits:
// 1) Last known state with full threshold signatures
// 2) The signed transactions starting from 1) up until the last known transaction which response the participant signed
// 3) What they're disputing or enforcing

//The DLT can set any reality and those realites are forks - the users follow the state machine set by the latest fork

export type AgreementFork = {
    forkGenesisStateEncoded: string; //genesis state (encoded) of the fork
    genesisParticipants: AddressLike[];
    genesisTimestamp: number; //timestamp of the first block in the fork
    chainBlocks: ChainBlock[]; //Blocks that are posted on chain for the fork
    agreements: Agreement[]; //The agreements that are part of the fork - total order
    forkProof: ForkProofStruct;
};

export type Agreement = {
    blockConfirmation: BlockConfirmationStruct;
    encodedState: string;
    addressesInThreshold: AddressLike[];
    snapShot: StateSnapshotStruct;
};

export type ChainBlock = {
    signedBlock: SignedBlockStruct;
    timestamp: number;
};
