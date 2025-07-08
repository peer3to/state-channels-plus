import { ethers } from "ethers";
import {
    StateSnapshotStruct,
    StateSnapshotStructOutput
} from "@typechain-types/contracts/V1/types/DataTypes";
import { Codec, Type } from "../utils/Codec";

import { Bytes, Hash } from "@/types/types";

export default class StateSnapshot {
    private constructor(private readonly snapshot: StateSnapshotStruct) {}

    static from(snapshot: StateSnapshotStruct): StateSnapshot;
    static from(snapshot: StateSnapshotStructOutput): StateSnapshot;
    static from(
        snapshot: StateSnapshotStruct | StateSnapshotStructOutput
    ): StateSnapshot {
        return new StateSnapshot(snapshot);
    }

    static decode(encoded: Bytes): StateSnapshot {
        const snapshot = Codec.decode(encoded, Type.StateSnapshot);
        return StateSnapshot.from(snapshot);
    }

    toStruct(): StateSnapshotStruct {
        return this.snapshot;
    }

    encode(): Bytes {
        return Codec.encode(this.snapshot, Type.StateSnapshot);
    }

    get hash(): Hash {
        return ethers.keccak256(this.encode()) as Hash;
    }

    get latestJoinBlockHash(): Hash {
        return this.snapshot.snapshotData.latestJoinChannelBlockHash as Hash;
    }
}
