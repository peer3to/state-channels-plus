import { expect } from "chai";
import sinon from "sinon";

import { config, createConfig } from "@/utils/config";
import { createLogger } from "@platform/createLogger";
import type {
    PerformanceSample,
    PerformanceSampleSource
} from "@/utils/logging/performanceMonitorInternal";

const THRESHOLD_MS = 100;
const INTERVAL_MS = 50;

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

/**
 * Direct process tests of the Node event-loop monitor. The process config in
 * the test suite carries a one-second global threshold, and the monitor writes
 * its timing marker straight to stdout whenever that threshold is above zero,
 * so each case zeroes the global threshold for its duration and drives the
 * synthetic threshold through the internal options only.
 */
describe("NodeLogger performance monitor", function () {
    let clock: sinon.SinonFakeTimers;
    let previousConfig: typeof config;

    beforeEach(function () {
        previousConfig = { ...config };
        createConfig({
            ...previousConfig,
            EVENT_LOOP_DELAY_ERROR_THRESHOLD_SECONDS: 0
        });
        clock = sinon.useFakeTimers({
            toFake: [
                "setInterval",
                "clearInterval",
                "setTimeout",
                "clearTimeout"
            ]
        });
    });

    afterEach(function () {
        clock.restore();
        createConfig(previousConfig);
    });

    async function startMonitor(
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

    it("throws the unchanged watchdog message with structured delay data once a sample crosses the threshold", async function () {
        const logger = await startMonitor([
            {
                dMean: 2,
                d50: 2,
                d90: 3,
                d99: 4,
                dMax: 1000,
                utilization: 0.5
            }
        ]);
        let thrown: unknown;
        try {
            clock.tick(INTERVAL_MS);
        } catch (error) {
            thrown = error;
        } finally {
            logger.stopPerformanceMonitoring();
        }
        expect(thrown).to.be.instanceOf(Error);
        const error = thrown as Error & { eventLoopDelay?: unknown };
        expect(error.message).to.equal(
            `Event loop delay 1000ms exceeded configured threshold ${THRESHOLD_MS}ms`
        );
        expect(error.eventLoopDelay).to.deep.include({
            runtime: "node",
            dMax: 1000,
            delayErrorThresholdMs: THRESHOLD_MS
        });
    });

    it("stops sampling after the throw so a later tick reports nothing", async function () {
        const logger = await startMonitor([
            {
                dMean: 2,
                d50: 2,
                d90: 3,
                d99: 4,
                dMax: 1000,
                utilization: 0.5
            },
            {
                dMean: 2,
                d50: 2,
                d90: 3,
                d99: 4,
                dMax: 1000,
                utilization: 0.5
            }
        ]);
        let throws = 0;
        try {
            for (let tick = 0; tick < 3; tick += 1) {
                try {
                    clock.tick(INTERVAL_MS);
                } catch {
                    throws += 1;
                }
            }
        } finally {
            logger.stopPerformanceMonitoring();
        }
        expect(throws).to.equal(1);
    });

    it("keeps sampling quietly while every sample stays below the threshold", async function () {
        const logger = await startMonitor([]);
        let thrown: unknown;
        try {
            clock.tick(INTERVAL_MS * 3);
        } catch (error) {
            thrown = error;
        } finally {
            logger.stopPerformanceMonitoring();
        }
        expect(thrown).to.equal(undefined);
    });
});
