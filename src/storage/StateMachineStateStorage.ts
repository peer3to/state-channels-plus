import {
    PersistentCollection,
    type PersistenceController
} from "./persistence";
import type { Bytes, Hash } from "@/types/types";
import { ethers } from "ethers";

type StoreOptions = {
    hash?: Hash;
};

export class StateMachineStateStorage {
    private readonly statesByHash: PersistentCollection<Hash, Bytes>;

    constructor(controller?: PersistenceController) {
        this.statesByHash = new PersistentCollection(
            "stateMachineStates",
            controller
        );
    }

    // ====================================
    // CREATE
    // ====================================

    public storeStateMachineState(
        encodedState: Bytes,
        options?: StoreOptions
    ): Hash {
        const hash = options?.hash ?? ethers.keccak256(encodedState);
        this.statesByHash.set(hash, encodedState);
        return hash;
    }

    // ====================================
    // READ
    // ====================================

    public getStateMachineState(hash: Hash): Bytes | undefined {
        return this.statesByHash.get(hash);
    }
}
