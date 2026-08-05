import { ForkId } from "@/types/types";

import { TimeoutStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";

export class TimeoutStorage {
    // ====================================
    // STORAGE MAP
    // ====================================
    private timeouts: Map<ForkId, TimeoutStruct>;

    constructor() {
        this.timeouts = new Map();
    }

    // ====================================
    // PERSISTENCE
    // ====================================

    /** The persistence engine's view of this store's PRIMARY map. */
    *persistableEntries(): Iterable<[ForkId, TimeoutStruct]> {
        yield* this.timeouts;
    }

    // ====================================
    // CREATE & UPDATE
    // ====================================

    storeTimeout(forkId: ForkId, timeout: TimeoutStruct): void {
        const existingTimeout = this.timeouts.get(forkId);
        if (
            existingTimeout &&
            timeout.blockHeight > existingTimeout.blockHeight
        )
            return;
        this.timeouts.set(forkId, timeout);
    }

    // ====================================
    // READ
    // ====================================
    getTimeout(forkId: ForkId): TimeoutStruct | undefined {
        return this.timeouts.get(forkId);
    }
}
