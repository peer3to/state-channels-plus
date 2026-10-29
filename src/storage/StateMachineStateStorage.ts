import { Hash, Bytes } from "@/types/types";
import { ethers } from "ethers";

type StoreOptions = {
    hash?: Hash;
};

export class StateMachineStateStorage {
    private statesByHash: Map<Hash, Bytes>;

    constructor() {
        this.statesByHash = new Map();
    }

    // ====================================
    // CREATE
    // ====================================

    storeStateMachineState(encodedState: Bytes, options?: StoreOptions): Hash {
        const hash = options?.hash ?? ethers.keccak256(encodedState);
        this.statesByHash.set(hash, encodedState);

        return hash;
    }

    // ====================================
    // READ
    // ====================================

    getStateMachineState(hash: Hash): Bytes | undefined {
        return this.statesByHash.get(hash);
    }
}
