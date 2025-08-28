import { ethers } from "ethers";
import {
    StateSnapshotStruct,
    StateSnapshotStructOutput,
    SnapshotDataStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { Codec, Type } from "../utils/Codec";

import { BlockHeight, Bytes, ForkId, Hash, Timestamp } from "@/types/types";

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

    get forkId(): ForkId {
        return this.snapshot.forkId as ForkId;
    }

    get timestamp(): Timestamp {
        return Number(this.snapshot.timestamp);
    }

    get blockHeight(): BlockHeight {
        return Number(this.snapshot.blockHeight);
    }

    get snapshotData(): SnapshotDataStruct {
        return this.snapshot.snapshotData;
    }

    get snapshotDataHash(): Hash {
        return ethers.keccak256(
            Codec.encode(this.snapshot.snapshotData, Type.SnapshotData)
        ) as Hash;
    }

    get stateMachineStateHash(): Hash {
        return this.snapshot.snapshotData.stateMachineStateHash;
    }

    get isGenesis(): boolean {
        return this.forkId === this.snapshotDataHash;
    }
}
