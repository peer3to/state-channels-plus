// W6 - worker-side loop-delay guard consumer. samples event-loop-delay via
// perf_hooks. when an observation exceeds the threshold, push one frame to
// the orchestrator on the "loop.stall" topic. orchestrator marks the active
// test failed (W6 §orchestrator-side handling).
//
// W0 D-9 - guard policy is boss-shipped; this is the consumer wiring.
// W6 §wire frame - one push per LoopDelayExceededError; dedupe lives in the
// harness (Set<number> cleared in afterEach).

import { monitorEventLoopDelay, type IntervalHistogram } from "node:perf_hooks";

import type { RpcServer } from "../rpc/rpc-server";

export const LOOP_STALL_TOPIC = "loop.stall";

export type LoopStallPayload = {
    workerIndex: number;
    observedMs: number;
    thresholdMs: number;
};

export type LoopGuardHandle = {
    stop(): void;
};

// step 1 - sampling resolution. boss's policy is a single-sample threshold;
// we sample frequently enough to catch a ~1s stall promptly. resolution is
// in ms; 50ms gives ~20 samples per second.
const SAMPLE_RESOLUTION_MS = 50;

// step 1 - check interval. we don't need to push more than once per stall;
// dedupe is orchestrator-side. checking every 200ms is plenty.
const CHECK_INTERVAL_MS = 200;

export function startLoopGuard(args: {
    workerIndex: number;
    thresholdMs: number;
    server: RpcServer;
}): LoopGuardHandle {
    const { workerIndex, thresholdMs, server } = args;

    const histogram: IntervalHistogram = monitorEventLoopDelay({
        resolution: SAMPLE_RESOLUTION_MS
    });
    histogram.enable();

    // step 1 - dedupe within this guard instance. one push per worker per
    // stall window; orchestrator also dedupes per test in afterEach.
    let pushed = false;

    const timer = setInterval(() => {
        // step 1 - histogram.max is in nanoseconds; convert to ms.
        const observedMs = histogram.max / 1_000_000;
        if (observedMs > thresholdMs && !pushed) {
            pushed = true;
            const payload: LoopStallPayload = {
                workerIndex,
                observedMs,
                thresholdMs
            };
            server.push(LOOP_STALL_TOPIC, payload);
        }
    }, CHECK_INTERVAL_MS);

    // step 1 - don't keep the worker alive for the guard alone.
    timer.unref();

    return {
        stop(): void {
            clearInterval(timer);
            histogram.disable();
        }
    };
}
