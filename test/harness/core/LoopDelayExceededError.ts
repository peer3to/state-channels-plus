// W6 - orchestrator-side error class. test-side code recognizes the failure
// via `instanceof LoopDelayExceededError`. no `harnessAbort` discriminator
// field (W6 round-2 fix), no `source` discriminator. plain Error subclass.
//
// W0 D-9 - guard policy is boss-shipped; this is the consumer-side error
// the orchestrator constructs when a worker pushes a stall frame.

export class LoopDelayExceededError extends Error {
    constructor(
        readonly workerIndex: number,
        readonly observedMs: number,
        readonly thresholdMs: number
    ) {
        super(
            `worker ${workerIndex} loop-delay ${observedMs.toFixed(0)}ms > ${thresholdMs}ms`
        );
        this.name = "LoopDelayExceededError";
    }
}
