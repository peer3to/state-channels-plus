// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import type { PersistenceDatabaseHandle } from "@/storage/persistence";
import { MemoryLevel } from "memory-level";

type BatchOperation = {
    type: "put" | "del";
    key: string | Uint8Array;
    value?: string | Uint8Array;
};
type BatchOptions = { sync?: boolean };
/** abstract-level's implementation hook, absent from its public types */
type BatchHook = (
    this: MemoryLevel<string, string>,
    operations: BatchOperation[],
    options: BatchOptions
) => Promise<void>;

/**
 * A real `memory-level` whose batches the test can hold, release or fail.
 * Every batch is recorded with its options once it reaches the gate.
 */
export class GatedMemoryLevel extends MemoryLevel<string, string> {
    public readonly batches: Array<{
        operations: Array<{ type: "put" | "del"; key: string }>;
        sync: boolean;
        committed: boolean;
    }> = [];
    private held?: Promise<void>;
    private releaseHeld?: () => void;
    private failuresLeft = 0;

    constructor() {
        super({ keyEncoding: "utf8", valueEncoding: "utf8" });
    }

    /** a handle whose close keeps the records, so a test can reopen them */
    public handle(location = "memory:gated"): PersistenceDatabaseHandle {
        return {
            database: this,
            location,
            close: () => this.close(),
            destroy: () => this.clear()
        };
    }

    /** later batches wait at the gate until `release` */
    public hold(): void {
        this.held ??= new Promise((resolve) => {
            this.releaseHeld = resolve;
        });
    }

    public release(): void {
        this.releaseHeld?.();
        this.held = undefined;
        this.releaseHeld = undefined;
    }

    /** the next `count` batches fail at the gate */
    public failNext(count: number): void {
        this.failuresLeft = count;
    }

    public async _batch(
        operations: BatchOperation[],
        options: BatchOptions
    ): Promise<void> {
        const batch = {
            // the private api gets the store encoding: keys as bytes
            operations: operations.map(({ type, key }) => ({
                type,
                key: Buffer.from(key).toString("utf8")
            })),
            sync: options.sync === true,
            committed: false
        };
        this.batches.push(batch);
        if (this.held) await this.held;
        if (this.failuresLeft > 0) {
            this.failuresLeft--;
            throw new Error("gated batch failed");
        }
        await (
            MemoryLevel.prototype as unknown as { _batch: BatchHook }
        )._batch.call(this, operations, options);
        batch.committed = true;
    }
}
