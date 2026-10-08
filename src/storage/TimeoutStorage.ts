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
    // CREATE & UPDATE
    // ====================================

    // stores happen only at the node's next height, so a stored timeout at a
    // lower height names a height the node already passed -> newest wins
    storeTimeout(forkId: ForkId, timeout: TimeoutStruct): void {
        this.timeouts.set(forkId, timeout);
    }

    // drops any stored timeout, forced included
    removeTimeout(forkId: ForkId): void {
        this.timeouts.delete(forkId);
    }

    // drops a refused plain timeout; a forced one stored since survives
    deleteTimeout(forkId: ForkId, refused: TimeoutStruct): void {
        const existingTimeout = this.timeouts.get(forkId);
        if (
            existingTimeout &&
            BigInt(existingTimeout.blockHeight) ===
                BigInt(refused.blockHeight) &&
            existingTimeout.participant === refused.participant &&
            !existingTimeout.isForced
        )
            this.timeouts.delete(forkId);
    }

    // ====================================
    // READ
    // ====================================
    getTimeout(forkId: ForkId): TimeoutStruct | undefined {
        return this.timeouts.get(forkId);
    }
}
