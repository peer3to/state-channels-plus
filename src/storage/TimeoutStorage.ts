import { ForkId } from "@/types/types";

import { TimeoutStruct } from "@typechain-types/contracts/V1/StateChannelManagerEvents";

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

    // ====================================
    // READ
    // ====================================
    getTimeout(forkId: ForkId): TimeoutStruct | undefined {
        return this.timeouts.get(forkId);
    }
}
