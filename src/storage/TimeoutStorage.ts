import type { TimeoutStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";

import type { ForkId } from "@/types/types";

import {
    PersistentCollection,
    type PersistenceController
} from "./persistence";

export class TimeoutStorage {
    // ====================================
    // STORAGE MAP
    // ====================================
    private readonly timeouts: PersistentCollection<ForkId, TimeoutStruct>;

    constructor(controller?: PersistenceController) {
        this.timeouts = new PersistentCollection("timeout", controller);
    }

    // ====================================
    // CREATE & UPDATE
    // ====================================

    public storeTimeout(forkId: ForkId, timeout: TimeoutStruct): void {
        this.timeouts.update(forkId, (existing) => {
            if (existing && timeout.blockHeight > existing.blockHeight) {
                return existing;
            }
            return timeout;
        });
    }

    // ====================================
    // READ
    // ====================================

    public getTimeout(forkId: ForkId): TimeoutStruct | undefined {
        return this.timeouts.get(forkId);
    }
}
