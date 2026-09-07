// @spec-test-coverage-ignore: injected sample source drives the real Node monitor
import type {
    PerformanceSample,
    PerformanceSampleSource
} from "@/utils/logging/performanceMonitorInternal";
import { createLogger } from "@platform/createLogger";
export const THRESHOLD_MS = 100;
export const INTERVAL_MS = 50;
function scriptedSource(samples: PerformanceSample[]): PerformanceSampleSource {
    const quiet: PerformanceSample = {
        dMean: 1,
        d50: 1,
        d90: 1,
        d99: 1,
        dMax: 1,
        utilization: 0.01
    };
    return {
        start() {},
        sample() {
            return samples.shift() ?? quiet;
        },
        reset() {},
        stop() {}
    };
}

export async function startMonitor(
    samples: PerformanceSample[]
): Promise<ReturnType<typeof createLogger>> {
    const logger = createLogger(
        {},
        { component: "NodeLoggerMonitorTest" },
        { skipWriting: true, attachErrorListener: false }
    );
    let markStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
        markStarted = resolve;
    });
    logger.startPerformanceMonitoring({
        threadLabel: "test",
        intervalMs: INTERVAL_MS,
        delayErrorThresholdMs: THRESHOLD_MS,
        sampleSource: scriptedSource(samples),
        onStarted: markStarted
    });
    await started;
    return logger;
}

export function captureTimingMarkers(run: () => void): string[] {
    const markers: string[] = [];
    const original = process.stdout.write;
    process.stdout.write = function (chunk: any, ...args: any[]): boolean {
        if (typeof chunk === "string" && chunk.startsWith("##E2E_TIMING##")) {
            markers.push(chunk);
            return true;
        }
        return (original as any).call(this, chunk, ...args);
    };
    try {
        run();
        return markers;
    } finally {
        process.stdout.write = original;
    }
}
