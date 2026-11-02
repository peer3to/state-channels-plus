/**
 * Deadline of the SDK's own RPCs, which read through the mirror (for example
 * `dispute.constructDispute`): `NetworkRpcRouter` ends a request after the
 * channel's `agreementTime`. The provider is built once per runtime host,
 * before any channel and its `agreementTime` exists, so the real value cannot
 * reach it without new architecture; 3 s is the value the waits are held to.
 * The cap of {@link LearnedBackstop}, and nothing else.
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
 * How long a wait for something that should arrive soon may last when no
 * event ends it (a silent hang). Learned from how long arrivals took lately,
 * never longer than the cap, and the cap until an arrival was observed.
 */
export class LearnedBackstop {
    private readonly capMs: number;
    private readonly now: () => number;
    /** Arrival durations and when each was observed, oldest first. */
    private samples: { at: number; durationMs: number }[] = [];

    constructor(capMs: number, now: () => number = Date.now) {
        this.capMs = capMs;
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

    /** The longest a wait lasts now. */
    get boundMs(): number {
        this.prune();
        if (this.samples.length === 0) return this.capMs;
        const slowest = Math.max(...this.samples.map((s) => s.durationMs));
        return Math.min(this.capMs, BACKSTOP_MULTIPLE * slowest);
    }

    private prune(): void {
        const oldest = this.now() - BACKSTOP_WINDOW_MS;
        this.samples = this.samples.filter((sample) => sample.at >= oldest);
    }
}
