import { SignedBlockStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { Block } from "@/models";
import {
    Address,
    BlockHeight,
    Bytes,
    Timestamp,
    Signature
} from "@/types/types";
// A fork is created by a DLT by disputing someone or asking the DLT to enforce a state.
// The user initiating the process submits:
// 1) Last known state with full threshold signatures
// 2) The signed transactions starting from 1) up until the last known transaction which response the participant signed
// 3) What they're disputing or enforcing

//The DLT can set any reality and those realites are forks - the users follow the state machine set by the latest fork

export type AgreementFork = {
    forkGenesisStateEncoded: Bytes; //genesis state (encoded) of the fork
    addressesInThreshold: Address[]; //The addresses that are in the threshold
    genesisTimestamp: Timestamp; //timestamp of the first block in the fork
    chainBlocks: ChainBlocks[]; //Blocks that are posted on chain for the fork
    agreements: Agreement[]; //The agreements that are part of the fork - total order
};

export type Agreement = {
    block: Block;
    blockSignatures: Signature[];
    encodedState: Bytes;
};
export type ChainBlocks = {
    transactionCnt: BlockHeight;
    participantAdr: Address;
    timestamp: Timestamp;
};
export type BlockConfirmation = {
    originalSignedBlock: SignedBlockStruct;
    confirmationSignature: Signature;
};
