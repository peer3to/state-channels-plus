const { MAX_SLOTS_FROM_POOL } = require("./constants");

class AccountPartitionPool {
    constructor(size = MAX_SLOTS_FROM_POOL) {
        this.available = Array.from({ length: size }, (_, index) => index);
        this.leased = new Set();
    }

    acquire() {
        const partition = this.available.shift();
        if (partition === undefined) {
            throw new Error("No funded account partition is available");
        }
        this.leased.add(partition);
        return partition;
    }

    release(partition) {
        if (!this.leased.delete(partition)) {
            throw new Error(`Account partition ${partition} is not leased`);
        }
        this.available.push(partition);
    }
}

function accountPartitionFor(slot, accountPartition) {
    return slot ? accountPartition : 0;
}

module.exports = { AccountPartitionPool, accountPartitionFor };
