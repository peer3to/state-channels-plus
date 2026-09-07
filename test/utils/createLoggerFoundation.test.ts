import { config, createConfig } from "@/utils/config";
import { buildLoggerFoundation } from "@/utils/logging/createLoggerFoundation";
import { expect } from "chai";

describe("createLoggerFoundation", function () {
    it("uses config defaults and allocates a distinct store per call", function () {
        const first = buildLoggerFoundation();
        const second = buildLoggerFoundation();
        expect(first.skipWriting).to.equal(config.LOG_SKIP_WRITING);
        expect(first.logUploaderConfig.uploadEndpoint).to.equal(
            config.CRASH_LOG_UPLOAD_ENDPOINT
        );
        expect(first.logUploaderConfig.apiToken).to.equal(
            config.CRASH_LOG_API_TOKEN || ""
        );
        expect(first.logStore === second.logStore).to.equal(false);
    });
    it("preserves explicit false and uploader options", function () {
        const logUploaderConfig = {
            uploadEndpoint: "https://example.invalid/upload",
            apiToken: "test-token"
        };
        const result = buildLoggerFoundation({
            skipWriting: false,
            logUploaderConfig
        });
        expect(result.skipWriting).to.equal(false);
        expect(result.logUploaderConfig === logUploaderConfig).to.equal(true);
    });
    it("disables storage when upload is disabled", function () {
        const previous = { ...config };
        try {
            createConfig({ ...previous, CRASH_LOG_UPLOAD_ENDPOINT: "" });
            const { logStore } = buildLoggerFoundation();
            logStore.store({
                time: "0",
                level: "info",
                context: {},
                sharedContext: {},
                message: "disabled",
                meta: [],
                stack: ""
            });
            expect(logStore.getAllLogs()).to.have.length(0);
        } finally {
            createConfig(previous);
        }
    });
    it("uses the default store size for zero configuration", function () {
        const previous = { ...config };
        try {
            createConfig({
                ...previous,
                CRASH_LOG_UPLOAD_ENDPOINT: "https://example.invalid/upload",
                CRASH_LOG_MAX_SIZE_MB: 0
            });
            const first = buildLoggerFoundation();
            const second = buildLoggerFoundation();
            first.logStore.store({
                time: "0",
                level: "info",
                context: {},
                sharedContext: {},
                message: "retained",
                meta: [],
                stack: ""
            });
            expect(first.logStore.getAllLogs()).to.have.length(1);
            expect(second.logStore.getAllLogs()).to.have.length(0);
        } finally {
            createConfig(previous);
        }
    });
});
