import type { LoggerPerformanceMonitorOptions, Logger } from "./Logger";
import { config } from "../config";

/**
 * Structured data the watchdog attaches to its error. It rides the error as
 * `eventLoopDelay` and must be projected explicitly across every port hop,
 * because structured cloning an `Error` keeps only its standard slots.
 */
export type EventLoopDelayDetails = {
    runtime: "node" | "browser";
    dMean: number;
    d50: number;
    d90: number;
    d99: number;
    dMax: number;
    utilization?: number;
    estimatedUtilization?: number;
    longTaskCount?: number;
    longTaskMean?: number;
    longTaskMax?: number;
    /** Thread CPU time and run-queue wait over the interval (Linux only). */
    cpuMs?: number;
    runQueueWaitMs?: number;
    /** Host-level stall counters over the interval (Linux main thread only). */
    hostBusy?: number;
    hostSteal?: number;
    hostCpuPressureMs?: number;
    cgroupThrottledMs?: number;
    delayErrorThresholdMs: number;
};

/**
 * One event-loop sample in the shape both monitors report. `utilization` is
 * measured on Node and estimated in the browser; the long-task fields exist
 * only in the browser.
 */
export type PerformanceSample = {
    dMean: number;
    d50: number;
    d90: number;
    d99: number;
    dMax: number;
    utilization: number;
    longTaskCount?: number;
    longTaskMean?: number;
    longTaskMax?: number;
    /**
     * Thread scheduler time over the interval, read from the kernel on Linux:
     * CPU time actually consumed and time spent runnable but waiting for a
     * CPU. Together with the delay they separate the thread's own work from
     * host contention and from blocking waits.
     */
    cpuMs?: number;
    runQueueWaitMs?: number;
    /**
     * Host-level view over the same interval, read once per process by the
     * main thread on Linux: the share of all CPU time that was busy and the
     * share stolen by a hypervisor (from /proc/stat), the kernel's CPU
     * pressure-stall time (some task runnable but waiting, from
     * /proc/pressure/cpu) and this cgroup's quota throttling. Together they
     * say whether a run-queue wait came from a burst, from steal or from a
     * quota, none of which a utilization average can show.
     */
    hostBusy?: number;
    hostSteal?: number;
    hostCpuPressureMs?: number;
    cgroupThrottledMs?: number;
};

/**
 * Where a monitor reads its samples. Production uses the real histogram and
 * utilization readers; tests inject a scripted source to produce one
 * over-threshold sample deterministically.
 */
export type PerformanceSampleSource = {
    start(): void;
    sample(): PerformanceSample;
    /** Called after each reported interval so the next sample starts fresh. */
    reset(): void;
    stop(): void;
};

/**
 * Internal monitor options: the exported {@link LoggerPerformanceMonitorOptions}
 * plus test seams. Not re-exported from the package root.
 */
export type PerformanceMonitorInternalOptions =
    LoggerPerformanceMonitorOptions & {
        sampleSource?: PerformanceSampleSource;
        /** Fires once the sampling interval is installed. */
        onStarted?: () => void;
    };

export function reportPerformanceSample(
    logger: Logger,
    sample: PerformanceSample,
    options: LoggerPerformanceMonitorOptions,
    runtime: "node" | "browser"
): EventLoopDelayDetails | undefined {
    const {
        dMean,
        d50,
        d90,
        d99,
        dMax,
        utilization,
        cpuMs,
        runQueueWaitMs,
        hostBusy,
        hostSteal,
        hostCpuPressureMs,
        cgroupThrottledMs
    } = sample;
    const longTaskMax = sample.longTaskMax ?? 0;
    const delayWarnThresholdMs = options.delayWarnThresholdMs ?? 200;
    const utilizationWarnThreshold = options.utilizationWarnThreshold ?? 0.8;
    const shouldWarn =
        utilization > utilizationWarnThreshold ||
        dMean > delayWarnThresholdMs ||
        d50 > delayWarnThresholdMs ||
        d90 > delayWarnThresholdMs ||
        d99 > delayWarnThresholdMs ||
        dMax > delayWarnThresholdMs ||
        (runtime === "browser" && longTaskMax > delayWarnThresholdMs);
    const metadata = {
        runtime,
        dMean,
        d50,
        d90,
        d99,
        dMax,
        ...(runtime === "node"
            ? { utilization }
            : {
                  estimatedUtilization: utilization,
                  longTaskCount: sample.longTaskCount ?? 0,
                  longTaskMean: sample.longTaskMean ?? 0,
                  longTaskMax
              }),
        ...(cpuMs !== undefined && runQueueWaitMs !== undefined
            ? { cpuMs, runQueueWaitMs }
            : {}),
        ...(hostBusy !== undefined && hostSteal !== undefined
            ? { hostBusy, hostSteal }
            : {}),
        ...(hostCpuPressureMs !== undefined ? { hostCpuPressureMs } : {}),
        ...(cgroupThrottledMs !== undefined ? { cgroupThrottledMs } : {})
    };
    const logFn = shouldWarn
        ? logger.warn.bind(logger)
        : logger.verbose.bind(logger);
    logFn(
        `Event Loop mean delay: ${dMean}ms, max: ${dMax}ms, ${runtime === "browser" ? "estimated utilization" : "utilization"}: ${utilization}`,
        metadata
    );
    const delayErrorThresholdMs =
        options.delayErrorThresholdMs !== undefined
            ? options.delayErrorThresholdMs
            : (config.EVENT_LOOP_DELAY_ERROR_THRESHOLD_SECONDS || 0) * 1000;
    const maxDelayMs =
        runtime === "browser" ? Math.max(dMax, longTaskMax) : dMax;
    return delayErrorThresholdMs > 0 && maxDelayMs > delayErrorThresholdMs
        ? { ...metadata, delayErrorThresholdMs }
        : undefined;
}
