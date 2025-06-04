import type { BytesLike } from "ethers";

import type {
    TransactionStruct,
    StateSnapshotStruct
} from "@typechain-types/contracts/V1/DataTypes";

export type UnrolledBlock = {
    transaction: TransactionStruct;
    stateSnapshot: StateSnapshotStruct;
    previousBlockHash: BytesLike;
};

export type UnrolledSignedBlock = {
    block: UnrolledBlock;
    signature: BytesLike;
};

export type UnrolledSignedBlockOutput = {
    block: UnrolledBlock;
    signature: BytesLike;
};
