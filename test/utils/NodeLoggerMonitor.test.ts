import { config, createConfig } from "@/utils/config";
import { LogStore } from "@/utils/logging/logStore";
import { NodeLogger } from "@/utils/logging/node/NodeLogger";
import { createLogger } from "@platform/createLogger";
import { captureTimingMarkers } from "@test/fixtures/NodeLoggerMonitorStaging";
import {
    INTERVAL_MS,
    startMonitor,
    THRESHOLD_MS
} from "@test/fixtures/NodeLoggerMonitorStaging";
import { quietSample } from "@test/fixtures/PerformanceReportingStaging";
import { expect } from "chai";
import sinon from "sinon";

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
    it("resets after each sample and stops the source on explicit stop", function () {
        let samples = 0;
        let resets = 0;
        let stops = 0;
        const logger = createLogger(
            {},
            {},
            { skipWriting: true, attachErrorListener: false }
        );
        logger.startPerformanceMonitoring({
            intervalMs: INTERVAL_MS,
            sampleSource: {
                start() {},
                sample() {
                    samples++;
                    return quietSample;
                },
                reset() {
                    resets++;
                },
                stop() {
                    stops++;
                }
            }
        });
        clock.tick(INTERVAL_MS * 2);
        logger.stopPerformanceMonitoring();
        clock.tick(INTERVAL_MS);
        expect({ samples, resets, stops }).to.deep.equal({
            samples: 2,
            resets: 2,
            stops: 1
        });
        logger.dispose();
    });

    it("can stop before the real sample source becomes ready", async function () {
        const logger = createLogger(
            {},
            {},
            { skipWriting: true, attachErrorListener: false }
        );
        let starts = 0;
        logger.startPerformanceMonitoring({
            onStarted() {
                starts++;
            }
        });
        logger.stopPerformanceMonitoring();
        await new Promise<void>((resolve) => setImmediate(resolve));
        clock.tick(INTERVAL_MS * 2);
        expect(starts).to.equal(0);
        logger.dispose();
    });

    it("emits timing markers only when the running peak increases", async function () {
        createConfig({
            ...config,
            EVENT_LOOP_DELAY_ERROR_THRESHOLD_SECONDS: 1
        });
        const logger = await startMonitor([
            { ...quietSample, dMax: 2 },
            { ...quietSample, dMax: 1 },
            { ...quietSample, dMax: 3 }
        ]);
        try {
            const markers = captureTimingMarkers(() =>
                clock.tick(INTERVAL_MS * 3)
            );
            expect(markers).to.deep.equal([
                '##E2E_TIMING## {"maxEventLoopDelayMs":2,"elThread":"test"}\n',
                '##E2E_TIMING## {"maxEventLoopDelayMs":3,"elThread":"test"}\n'
            ]);
        } finally {
            logger.dispose();
        }
    });

    it("warns when the real histogram source rejects an invalid resolution", async function () {
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
            logger.startPerformanceMonitoring({ sampleIntervalMs: 0 });
            await new Promise<void>((resolve) => setImmediate(resolve));
            const entry = store
                .getAllLogs()
                .find(
                    (entry) =>
                        entry.message ===
                        "Event loop performance monitoring unavailable"
                );
            expect(entry?.level).to.equal("warn");
            expect(entry?.meta[0].error).to.include("resolution");
        } finally {
            logger.dispose();
        }
    });
});
