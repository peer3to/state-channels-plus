const {
    AccountPartitionPool,
    accountPartitionFor
} = require("./accountPartitionPool");
const { requiresChainSlot } = require("./taskRunners");
const { buildSlotEnv } = require("./scheduling");

class TaskResourcePool {
    constructor({ baseEnv, slots, accountPartitions }) {
        this.baseEnv = baseEnv;
        this.slots = slots;
        this.accountPartitions =
            accountPartitions || new AccountPartitionPool();
        this.slotSequence = 0;
    }

    acquire(task) {
        const needsChain = requiresChainSlot(task);
        if (!needsChain) {
            return {
                needsChain,
                accountPartition: null,
                slot: null,
                env: { ...this.baseEnv },
                release() {}
            };
        }

        const accountPartition = this.accountPartitions.acquire();
        const slot = this.slots.length
            ? this.slots[this.slotSequence++ % this.slots.length]
            : null;
        let released = false;
        return {
            needsChain,
            accountPartition,
            slot,
            env: {
                ...this.baseEnv,
                ...buildSlotEnv(
                    slot,
                    accountPartitionFor(slot, accountPartition)
                )
            },
            release: () => {
                if (released) return;
                released = true;
                this.accountPartitions.release(accountPartition);
            }
        };
    }
}

module.exports = { TaskResourcePool };
