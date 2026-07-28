import { ethers } from "ethers";

import type { Bytes, Hash } from "@/types/types";

import {
    PersistentCollection,
    type PersistenceController
} from "./persistence";

type StoreOptions = {
    hash?: Hash;
};

export class StateMachineStateStorage {
    private readonly states: PersistentCollection<Hash, Bytes>;

    constructor(controller?: PersistenceController) {
        this.states = new PersistentCollection(
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
        this.states.set(hash, encodedState);
        return hash;
    }

    // ====================================
    // READ
    // ====================================

    public getStateMachineState(hash: Hash): Bytes | undefined {
        return this.states.get(hash);
    }
}
