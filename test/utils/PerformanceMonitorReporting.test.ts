import { config, createConfig } from "@/utils/config";
import {
    capturePerformanceReport,
    quietSample
} from "@test/fixtures/PerformanceReportingStaging";
import { expect } from "chai";

describe("performance monitor reporting", function () {
    it("reports exact Node verbose metadata below thresholds", function () {
        const { entries, details } = capturePerformanceReport(
            quietSample,
            { delayErrorThresholdMs: 100 },
            "node"
        );
        expect(details).to.equal(undefined);
        expect(entries[0].level).to.equal("verbose");
        expect(entries[0].message).to.equal(
            "Event Loop mean delay: 1ms, max: 1ms, utilization: 0.1"
        );
        expect(entries[0].meta[0]).to.deep.equal({
            runtime: "node",
            ...quietSample
        });
    });
    it("reports browser defaults with estimated utilization only", function () {
        const { entries } = capturePerformanceReport(
            quietSample,
            { delayErrorThresholdMs: 100 },
            "browser"
        );
        expect(entries[0].message).to.equal(
            "Event Loop mean delay: 1ms, max: 1ms, estimated utilization: 0.1"
        );
        expect(entries[0].meta[0]).to.deep.equal({
            runtime: "browser",
            dMean: 1,
            d50: 1,
            d90: 1,
            d99: 1,
            dMax: 1,
            estimatedUtilization: 0.1,
            longTaskCount: 0,
            longTaskMean: 0,
            longTaskMax: 0
        });
    });
    it("warns and returns browser threshold details for long tasks alone", function () {
        const { entries, details } = capturePerformanceReport(
            {
                ...quietSample,
                longTaskMax: 201,
                longTaskMean: 201,
                longTaskCount: 1
            },
            { delayWarnThresholdMs: 100, delayErrorThresholdMs: 200 },
            "browser"
        );
        expect(entries[0].level).to.equal("warn");
        expect(details).to.deep.equal({
            ...entries[0].meta[0],
            delayErrorThresholdMs: 200
        });
    });
    it("does not warn or trip at exact thresholds", function () {
        const { entries, details } = capturePerformanceReport(
            { ...quietSample, dMax: 200, utilization: 0.8 },
            { delayWarnThresholdMs: 200, delayErrorThresholdMs: 200 },
            "node"
        );
        expect(entries[0].level).to.equal("verbose");
        expect(details).to.equal(undefined);
    });
    it("warns and trips above the Node maximum threshold", function () {
        const { entries, details } = capturePerformanceReport(
            { ...quietSample, dMax: 201 },
            { delayWarnThresholdMs: 200, delayErrorThresholdMs: 200 },
            "node"
        );
        expect(entries[0].level).to.equal("warn");
        expect(details?.dMax).to.equal(201);
    });
    it("disables threshold errors without disabling warnings", function () {
        const { entries, details } = capturePerformanceReport(
            { ...quietSample, dMax: 201 },
            { delayErrorThresholdMs: 0 },
            "node"
        );
        expect(entries[0].level).to.equal("warn");
        expect(details).to.equal(undefined);
    });
    it("reads the current config threshold for each report", function () {
        const previous = { ...config };
        try {
            createConfig({
                ...previous,
                EVENT_LOOP_DELAY_ERROR_THRESHOLD_SECONDS: 0
            });
            expect(
                capturePerformanceReport(
                    { ...quietSample, dMax: 201 },
                    {},
                    "node"
                ).details
            ).to.equal(undefined);
            createConfig({
                ...previous,
                EVENT_LOOP_DELAY_ERROR_THRESHOLD_SECONDS: 0.1
            });
            expect(
                capturePerformanceReport(
                    { ...quietSample, dMax: 201 },
                    {},
                    "node"
                ).details?.delayErrorThresholdMs
            ).to.equal(100);
        } finally {
            createConfig(previous);
        }
    });
});
