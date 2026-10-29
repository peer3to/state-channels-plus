import type { Block, StateSnapshot } from "@/models";
import type { SignedBlockStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { SignatureLike, BytesLike, AddressLike, BigNumberish } from "ethers";

export type Hash = BytesLike;
export type ForkId = Hash;
export type BlockHeight = number;
export type Timestamp = number;
export type Address = AddressLike;
/** Lowercase hex Hyperswarm public key of a transport that has not authenticated yet. */
export type HpAddress = string;
/** Identity strikes count against: the EVM address once proven, the Hyperswarm key before. */
export type PeerKey = Address | HpAddress;
export type ChecksumAddress = string;
/** 4-byte contract function selector as a 0x-prefixed hex string. */
export type FunctionSelector = string;
export type ChannelId = BytesLike;
export type Signature = SignatureLike;
export type Bytes = BytesLike;
export type Amount = BigNumberish;

// composite types

export type BlockOrSnapshot = {
    block?: Block;
    stateSnapshot?: StateSnapshot;
};

export type BlockCalldata = {
    signedBlock: SignedBlockStruct;
    onChainTimestamp: Timestamp;
};
