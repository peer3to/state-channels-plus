import { Block, StateSnapshot } from "@/models";
import { SignatureLike, BytesLike, AddressLike, BigNumberish } from "ethers";

export type Hash = BytesLike;
export type ForkId = Hash;
export type BlockHeight = number;
export type Timestamp = number;
export type Address = AddressLike;
export type ChannelId = BytesLike;
export type Signature = SignatureLike;
export type Bytes = BytesLike;
export type Amount = BigNumberish;

// composiite types

export type BlockOrSnapshot = {
    block?: Block;
    stateSnapshot?: StateSnapshot;
};

export type ReductionTimeoutHandle = {
    handle: ReturnType<typeof setTimeout>;
    triggerTimestamp: number;
};
