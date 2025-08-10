import { StateSnapshot } from "@/models";
import { BlockConfirmationStruct } from "@typechain-types/contracts/V1/StateChannelManagerEvents";
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
    blockConfirmation?: BlockConfirmationStruct;
    stateSnapshot?: StateSnapshot;
};
