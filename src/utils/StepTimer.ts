import type { Logger } from "@/utils/logging/Logger";

/** One timed step: its milliseconds, and its chain requests when counted. */
type StepTiming = { ms: number; rpc?: number };

/**
 * Times consecutive steps of a setup, so a slow one shows where its time went.
 * `countRequests`, when given, reads a running count of chain requests; each
 * step then also records how many it sent.
 */
export class StepTimer {
    private readonly startedAtMs = Date.now();
    private lastAtMs = this.startedAtMs;
    private lastRequestCount: number;
    private readonly steps: Record<string, StepTiming> = {};

    constructor(private readonly countRequests?: () => number) {
        this.lastRequestCount = countRequests?.() ?? 0;
    }

    /** Ends the step running since the previous mark (or the start). */
    public mark(step: string): void {
        const nowMs = Date.now();
        const timing: StepTiming = { ms: nowMs - this.lastAtMs };
        this.lastAtMs = nowMs;
        if (this.countRequests) {
            const requestCount = this.countRequests();
            timing.rpc = requestCount - this.lastRequestCount;
            this.lastRequestCount = requestCount;
        }
        this.steps[step] = timing;
    }

    /** Logs every marked step and the total at debug level. */
    public log(logger: Logger, message: string): void {
        logger.debug(message, {
            ...this.steps,
            totalMs: Date.now() - this.startedAtMs
        });
    }
}
