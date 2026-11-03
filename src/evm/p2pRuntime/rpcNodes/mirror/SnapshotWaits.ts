import { MirrorUnavailableError } from "./MirrorUnavailableError";
import { LearnedBackstop } from "@/utils/storageDiff/LearnedBackstop";
import type { AccountAddress } from "@/utils/storageDiff/storageDiffWire";

/** How the wait for an account's snapshot ended for that account. */
type SnapshotWaitEnd = "arrived" | "delayed" | "not-coming";

/**
 * The reads waiting for the snapshot of an account the service has ready,
 * and how long such a wait may last when nothing ends it.
 */
export class SnapshotWaits {
    private readonly isComplete: (address: AccountAddress) => boolean;
    /**
     * Accounts whose snapshot a fill is waiting for, and what ends the wait;
     * it is told whether the service said the snapshot is delayed.
     */
    private readonly awaitedSnapshots = new Map<
        AccountAddress,
        (end: SnapshotWaitEnd) => void
    >();
    /**
     * How long a wait for a snapshot lasts when no event ends it, learned
     * from how long snapshots took: they come after a subscribe round trip,
     * which a block's record does not need.
     */
    private readonly snapshotBackstop: LearnedBackstop;
    /**
     * Snapshots being placed for a waiting read, which holds the lock for
     * them: the read ends only once they are placed.
     */
    private readonly placing = new Set<Promise<void>>();

    constructor(
        capMs: () => number,
        isComplete: (address: AccountAddress) => boolean
    ) {
        this.snapshotBackstop = new LearnedBackstop(capMs);
        this.isComplete = isComplete;
    }

    /** Whether a read waits for the snapshot of `address`. */
    isAwaited(address: AccountAddress): boolean {
        return this.awaitedSnapshots.has(address);
    }

    /** The wait for the snapshot of `address` is over: it arrived, or none is coming. */
    end(address: AccountAddress, how: "arrived" | "not-coming"): void {
        const done = this.awaitedSnapshots.get(address);
        this.awaitedSnapshots.delete(address);
        done?.(how);
    }

    /** The service said the snapshot of `address` is delayed. */
    delayed(address: AccountAddress): void {
        this.awaitedSnapshots.get(address)?.("delayed");
    }

    /** A snapshot a read waits for is being placed by `placed`. */
    holdWhile(placed: Promise<void>): void {
        this.placing.add(placed);
        void placed.finally(() => this.placing.delete(placed));
    }

    /** Ends every wait for a snapshot. */
    releaseAwaited(): void {
        for (const done of [...this.awaitedSnapshots.values()])
            done("not-coming");
        this.awaitedSnapshots.clear();
    }

    /**
     * Starts expecting the snapshots of `addresses`, before following them,
     * so one that arrives during that is applied at once. `settled` waits for
     * all of them; it ends at the first of: they all arrive, the service says
     * they are not coming (`lazy`: the read goes on and reads them as it
     * needs; delayed: the read throws and goes to the node), the connection
     * drops, or the learned backstop or the read's `timeLeftMs` runs out
     * (the read throws).
     */
    expectSnapshots(addresses: AccountAddress[]): {
        release: (addresses: AccountAddress[]) => void;
        settled: (timeLeftMs: number) => Promise<void>;
        forget: () => void;
    } {
        const waiting = addresses.filter(
            (address) => !this.isComplete(address)
        );
        // from here the subscribe and the snapshot's arrival are timed together
        const startedAt = Date.now();
        let remaining = waiting.length;
        let delayed = false;
        let resolveAll!: () => void;
        const all = new Promise<void>((resolve) => (resolveAll = resolve));
        if (remaining === 0) resolveAll();
        const ends = new Map<AccountAddress, (end: SnapshotWaitEnd) => void>();
        for (const address of waiting) {
            const done = (end: SnapshotWaitEnd) => {
                if (end === "delayed") delayed = true;
                if (end === "arrived")
                    this.snapshotBackstop.record(Date.now() - startedAt);
                if (--remaining === 0) resolveAll();
            };
            ends.set(address, done);
            this.awaitedSnapshots.set(address, done);
        }
        // drops this read's entries, and only its own
        const forget = () => {
            for (const [address, done] of ends)
                if (this.awaitedSnapshots.get(address) === done)
                    this.awaitedSnapshots.delete(address);
        };
        return {
            release: (released) => {
                for (const address of released) this.end(address, "not-coming");
            },
            settled: async (timeLeftMs) => {
                if (remaining === 0) return;
                let timer: ReturnType<typeof setTimeout> | undefined;
                let expiredAtBackstop = false;
                // the read's deadline bounds the wait as much as the backstop
                const expired = new Promise<void>((resolve) => {
                    timer = setTimeout(
                        () => {
                            expiredAtBackstop = true;
                            resolve();
                        },
                        Math.min(this.snapshotBackstop.boundMs, timeLeftMs)
                    );
                });
                await Promise.race([all, expired]);
                clearTimeout(timer);
                forget();
                // a snapshot still being placed moves the head under this read
                await Promise.all([...this.placing]);
                // a snapshot that did not come sends the read to the node
                if (expiredAtBackstop) {
                    throw new MirrorUnavailableError(
                        "The snapshot never reached the mirror"
                    );
                }
                if (delayed) {
                    throw new MirrorUnavailableError(
                        "The service said the snapshot is delayed"
                    );
                }
            },
            forget
        };
    }
}
