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

    storeTimeout(forkId: ForkId, timeout: TimeoutStruct): void {
        const existingTimeout = this.timeouts.get(forkId);
        if (
            existingTimeout &&
            timeout.blockHeight > existingTimeout.blockHeight
        )
            return;
        this.timeouts.set(forkId, timeout);
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
