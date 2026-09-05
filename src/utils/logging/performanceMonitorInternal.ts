import type { LoggerPerformanceMonitorOptions } from "./Logger";

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
