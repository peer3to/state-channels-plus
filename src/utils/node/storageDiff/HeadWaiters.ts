import {
    LearnedBackstop,
    SDK_RPC_DEADLINE_MS
} from "../../storageDiff/LearnedBackstop";
import type { StorageDiffDelayNotice } from "../../storageDiff/storageDiffWire";
import { toQuantity } from "ethers";

/** A read held until the best head reaches `minBlock`; `end` lets it go. */
interface HeadWaiter {
    minBlock: bigint;
    end: () => void;
}

/** What a wait uses of the service whose head it waits for. */
export interface HeadWaitersOptions {
    /** The number of the best head. */
    headNumber: () => bigint;
    /** The best head's number and hash. */
    bestHead: () => { number: string; hash: string };
    request: (method: string, params: unknown[]) => Promise<unknown>;
    /** Tells the service its upstream has not seen the block a read waits for. */
    noteDelay: (notice: StorageDiffDelayNotice) => void;
}

/** The reads held until the best head reaches the block their caller saw. */
export class HeadWaiters {
    private readonly headNumber: () => bigint;
    private readonly bestHead: () => { number: string; hash: string };
    private readonly request: (
        method: string,
        params: unknown[]
    ) => Promise<unknown>;
    private readonly noteDelay: (notice: StorageDiffDelayNotice) => void;
    // Reads waiting for the best head to reach the block their caller saw.
    private readonly waiters = new Set<HeadWaiter>();
    // How long such a read may wait when no event ends it: learned from how
    // long a new head took to commit after the upstream announced it.
    private readonly backstop = new LearnedBackstop(SDK_RPC_DEADLINE_MS);

    constructor(options: HeadWaitersOptions) {
        this.headNumber = options.headNumber;
        this.bestHead = options.bestHead;
        this.request = options.request;
        this.noteDelay = options.noteDelay;
    }

    /**
     * Resolves once the best head is at `minBlock` or higher, or at the first
     * of: the service saying the block is late (`endForDelay`: its
     * tracing failed or is retried, or the upstream has not seen the block),
     * the service closing, or the learned backstop for a service that hangs
     * silently. A caller then answers with what the service holds.
     */
    async reach(minBlock: bigint | undefined): Promise<void> {
        if (minBlock === undefined || this.headNumber() >= minBlock) return;
        await new Promise<void>((resolve) => {
            const waiter: HeadWaiter = {
                minBlock,
                end: () => {
                    clearTimeout(timer);
                    this.waiters.delete(waiter);
                    resolve();
                }
            };
            const timer = setTimeout(waiter.end, this.backstop.boundMs);
            this.waiters.add(waiter);
            void this.checkUpstreamHas(waiter);
        });
    }

    /**
     * Ends the waits a notice makes pointless. A block that fails to trace
     * holds back every block after it, so it ends every wait; an upstream
     * that has not seen block N ends the waits for N or later.
     */
    endForDelay(notice: StorageDiffDelayNotice): void {
        if (notice.reason === "trace-failed") {
            for (const waiter of [...this.waiters]) waiter.end();
        } else if (notice.reason === "upstream-behind") {
            const requested = BigInt(notice.requested);
            for (const waiter of [...this.waiters])
                if (waiter.minBlock >= requested) waiter.end();
        }
    }

    /** Ends the waits the best head has reached. */
    endReached(): void {
        for (const waiter of [...this.waiters])
            if (waiter.minBlock <= this.headNumber()) waiter.end();
    }

    /** Ends every wait, as the service closes. */
    endAll(): void {
        for (const waiter of [...this.waiters]) waiter.end();
    }

    /** Learns how long a new head took to commit after it was announced. */
    recordArrival(milliseconds: number): void {
        this.backstop.record(milliseconds);
    }

    /**
     * Asks the upstream for its newest block number; when it has not seen the
     * block `waiter` waits for, that block cannot arrive soon. A failed ask
     * leaves the wait to the backstop.
     */
    private async checkUpstreamHas(waiter: HeadWaiter): Promise<void> {
        try {
            const answer = await this.request("eth_blockNumber", []);
            if (!this.waiters.has(waiter) || typeof answer !== "string") return;
            if (BigInt(answer) >= waiter.minBlock) return;
            const head = this.bestHead();
            this.noteDelay({
                reason: "upstream-behind",
                requested: toQuantity(waiter.minBlock),
                head: { number: head.number, hash: head.hash }
            });
        } catch {
            // the backstop ends the wait
        }
    }
}
