/**
 * Deadline of the SDK's own RPCs, which read through the mirror (for example
 * `dispute.constructDispute`): `NetworkRpcRouter` ends a request after the
 * channel's `agreementTime`. The provider is built once per runtime host,
 * before any channel and its `agreementTime` exists, so the real value cannot
 * reach it without new architecture; 3 s is the value the waits are held to.
 * The storage diff service's cap of {@link LearnedBackstop}; the mirror's
 * waits cap it less the node's round trips ({@link capLeavingNodeRoundTrips}).
 */
export const SDK_RPC_DEADLINE_MS = 3_000;
/**
 * The backstop is this many times the slowest recent arrival: a wait ends at
 * the first event, so the backstop only has to tell a silent hang from the
 * slowest arrival the last window saw, with room for jitter.
 */
export const BACKSTOP_MULTIPLE = 4;
/**
 * Arrivals older than this are forgotten, so the backstop follows the chain's
 * present pace and one slow spell stops counting once it is over.
 */
export const BACKSTOP_WINDOW_MS = 30_000;

/**
 * The durations of recent arrivals, forgotten after
 * {@link BACKSTOP_WINDOW_MS}; what the slowest of them was.
 */
export class RecentSlowest {
    private readonly now: () => number;
    /** Arrival durations and when each was observed, oldest first. */
    private samples: { at: number; durationMs: number }[] = [];

    constructor(now: () => number = Date.now) {
        this.now = now;
    }

    /** Notes that something took `durationMs` to arrive. */
    record(durationMs: number): void {
        this.prune();
        this.samples.push({
            at: this.now(),
            durationMs: Math.max(0, durationMs)
        });
    }

    /** The longest recent arrival, or undefined when none was observed lately. */
    get slowestMs(): number | undefined {
        this.prune();
        if (this.samples.length === 0) return undefined;
        return Math.max(...this.samples.map((s) => s.durationMs));
    }

    private prune(): void {
        const oldest = this.now() - BACKSTOP_WINDOW_MS;
        this.samples = this.samples.filter((sample) => sample.at >= oldest);
    }
}

/**
 * The block numbers a node announced that the head has not reached yet, and
 * when each was announced; announcements older than {@link BACKSTOP_WINDOW_MS}
 * are forgotten.
 */
export class AnnouncedBlocks {
    private readonly now: () => number;
    /** When each announced block number was first announced, in epoch milliseconds. */
    private readonly announcedAt = new Map<bigint, number>();

    constructor(now: () => number = Date.now) {
        this.now = now;
    }

    /** How many announcements are held. */
    get size(): number {
        return this.announcedAt.size;
    }

    /** Notes that `number` was announced now, unless it already was. */
    announce(number: bigint): void {
        this.prune();
        if (!this.announcedAt.has(number))
            this.announcedAt.set(number, this.now());
    }

    /**
     * Takes the announcements up to `number`, which the head reached: how
     * long each took to arrive.
     */
    arrivedUpTo(number: bigint): number[] {
        this.prune();
        const now = this.now();
        const durations: number[] = [];
        for (const [announced, at] of this.announcedAt) {
            if (announced > number) continue;
            durations.push(now - at);
            this.announcedAt.delete(announced);
        }
        return durations;
    }

    /** Forgets the announcements of `number` and above: their blocks were orphaned. */
    forgetFrom(number: bigint): void {
        for (const announced of this.announcedAt.keys())
            if (announced >= number) this.announcedAt.delete(announced);
    }

    /** Forgets every announcement. */
    clear(): void {
        this.announcedAt.clear();
    }

    private prune(): void {
        const oldest = this.now() - BACKSTOP_WINDOW_MS;
        for (const [announced, at] of this.announcedAt)
            if (at < oldest) this.announcedAt.delete(announced);
    }
}

/**
 * The cap of a wait that ends in a read of a node, which must still answer
 * before `deadlineMs`: the deadline less {@link BACKSTOP_MULTIPLE} times the
 * slowest recent node round trip, never below zero. Until a round trip was
 * observed it is the whole deadline: nothing known yet says the node needs
 * any of it, and the first request forwarded to a node teaches it.
 */
export function capLeavingNodeRoundTrips(
    deadlineMs: number,
    nodeRoundTrips: RecentSlowest
): number {
    const slowest = nodeRoundTrips.slowestMs;
    if (slowest === undefined) return deadlineMs;
    return Math.max(0, deadlineMs - BACKSTOP_MULTIPLE * slowest);
}

/**
 * How long a wait for something that should arrive soon may last when no
 * event ends it (a silent hang). Learned from how long arrivals took lately,
 * never longer than the cap, and the cap until an arrival was observed. The
 * cap is a number, or a function when it follows something learned itself.
 */
export class LearnedBackstop {
    private readonly capMs: number | (() => number);
    private readonly arrivals: RecentSlowest;

    constructor(capMs: number | (() => number), now: () => number = Date.now) {
        this.capMs = capMs;
        this.arrivals = new RecentSlowest(now);
    }

    /** Notes that something took `durationMs` to arrive. */
    record(durationMs: number): void {
        this.arrivals.record(durationMs);
    }

    /** The longest a wait lasts now. */
    get boundMs(): number {
        const cap = typeof this.capMs === "number" ? this.capMs : this.capMs();
        const slowest = this.arrivals.slowestMs;
        if (slowest === undefined) return cap;
        return Math.min(cap, BACKSTOP_MULTIPLE * slowest);
    }
}
