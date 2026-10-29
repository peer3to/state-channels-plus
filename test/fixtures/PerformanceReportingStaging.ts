// @spec-test-coverage-ignore: captures real logger output for reporter tests
import type { LoggerPerformanceMonitorOptions } from "@/utils/logging/Logger";
import { LogStore } from "@/utils/logging/logStore";
import { NodeLogger } from "@/utils/logging/node/NodeLogger";
import type { PerformanceSample } from "@/utils/logging/performanceMonitorInternal";
import { reportPerformanceSample } from "@/utils/logging/performanceMonitorInternal";

export function capturePerformanceReport(
    sample: PerformanceSample,
    options: LoggerPerformanceMonitorOptions,
    runtime: "node" | "browser"
) {
    const store = new LogStore(1024 * 1024, true);
    const logger = new NodeLogger(
        {},
        {},
        "verbose",
        store,
        { attachErrorListener: false },
        new Set(),
        true
    );
    try {
        const details = reportPerformanceSample(
            logger,
            sample,
            options,
            runtime
        );
        return { details, entries: store.getAllLogs() };
    } finally {
        logger.dispose();
    }
}

export const quietSample: PerformanceSample = {
    dMean: 1,
    d50: 1,
    d90: 1,
    d99: 1,
    dMax: 1,
    utilization: 0.1
};
