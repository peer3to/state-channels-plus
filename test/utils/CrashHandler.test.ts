import { expect } from "chai";
import winston from "winston";
import Transport from "winston-transport";
import { setupCrashHandler } from "@/utils/logging/CrashHandler";
import { LoggingConfig, LoggingMode } from "@/utils/logging/LoggingConfig";

/**
 * Mock Winston transport that stores logs in memory
 * Uses setImmediate for async correctness (matches real transport behavior)
 */
class MockStorageTransport extends Transport {
    private logs: any[] = [];

    log(info: any, callback: () => void): void {
        // Store the log entry as-is (Winston formats it before calling log)
        this.logs.push(info);
        // Use setImmediate to ensure async behavior closer to real transports
        setImmediate(callback);
    }

    async flush(): Promise<void> {
        // no-op - logs are already in memory
    }

    async getAllLogs(): Promise<any[]> {
        return [...this.logs];
    }

    async clearLogs(): Promise<void> {
        this.logs = [];
    }
}

const CRASH_UPLOAD_ENDPOINT = "https://api.example.com/crash-upload";
const CRASH_UPLOAD_API_TOKEN = "test-token";
const CRASH_UPLOAD_PREFIX = "crash-";

describe("CrashHandler", function () {
    let originalFetch: typeof fetch;
    let uploads: Array<{
        url: string;
        headers: HeadersInit;
        body: any;
    }> = [];
    let loggingConfig: LoggingConfig;

    beforeEach(function () {
        // Disable CompressionStream
        (global as any).CompressionStream = undefined;

        // Polyfill btoa if not available (Node.js compatibility)
        if (typeof (global as any).btoa === "undefined") {
            (global as any).btoa = (str: string) => {
                return Buffer.from(str, "binary").toString("base64");
            };
        }

        // Mock fetch to capture requests
        uploads = [];
        originalFetch = global.fetch;
        global.fetch = async (
            url: string | URL | Request,
            options?: RequestInit
        ) => {
            uploads.push({
                url: typeof url === "string" ? url : url.toString(),
                headers: options?.headers || {},
                body: options?.body
            });

            return {
                ok: true,
                status: 200,
                statusText: "OK"
            } as Response;
        };
        loggingConfig = {
            enabled: true,
            level: "debug",
            mode: LoggingMode.TESTNET,
            console: false,
            crashUpload: {
                enabled: true,
                uploadEndpoint: CRASH_UPLOAD_ENDPOINT,
                apiToken: CRASH_UPLOAD_API_TOKEN,
                prefix: CRASH_UPLOAD_PREFIX
            }
        };
    });

    afterEach(function () {
        // Restore original fetch
        global.fetch = originalFetch;
        delete (global as any).CompressionStream;
        delete (global as any).btoa;
    });

    it("should collect logs, upload uncompressed NDJSON when CompressionStream is unavailable, and clear logs", async function () {
        // Create mock transport
        const mockTransport = new MockStorageTransport({
            format: winston.format.json()
        });

        // Create logger with ONLY the mock transport
        const logger = winston.createLogger({
            level: "debug",
            transports: [mockTransport]
        });

        // Create crash upload config

        // Write several logs
        logger.info("First log message", { component: "TestComponent" });
        logger.warn("Second log message", { component: "TestComponent" });
        logger.error("Third log message", { component: "TestComponent" });
        logger.debug("Fourth log message", { component: "TestComponent" });

        // Wait for async log processing
        await new Promise((resolve) => setImmediate(resolve));

        // Set up crash handler and get handle function
        const crashHandler = setupCrashHandler(logger, loggingConfig);
        expect(crashHandler).to.not.be.undefined;

        // Call handler directly (CompressionStream is undefined in beforeEach)
        const testError = new Error("Test crash error");
        await crashHandler!.handle(testError, "rejection");

        // Assert fetch was called exactly once
        expect(uploads.length).to.equal(
            1,
            "fetch should be called exactly once"
        );

        const upload = uploads[0];

        // Assert upload endpoint
        expect(upload.url).to.equal(CRASH_UPLOAD_ENDPOINT);

        // Assert headers
        expect(upload.headers).to.be.an("object");
        const headers = upload.headers as Record<string, string>;
        expect(headers["Authorization"]).to.equal(
            `Bearer ${CRASH_UPLOAD_API_TOKEN}`
        );
        expect(headers["Content-Type"]).to.equal("application/x-ndjson");

        // Compression fallback: Content-Encoding should NOT be present when CompressionStream is unavailable
        expect(headers["Content-Encoding"]).to.be.undefined;

        // Filename should end with .ndjson (not .gz) when uncompressed
        expect(headers["X-Filename"]).to.match(/^crash-\d+-[a-z0-9]+\.ndjson$/);
        expect(headers["X-Metadata"]).to.be.a("string");

        // Assert body is a Blob
        expect(upload.body).to.be.instanceof(Blob);

        // Read blob content as text (uncompressed NDJSON can be read directly)
        const blob = upload.body as Blob;
        const text = await blob.text();

        // Assert body contains newline-delimited JSON
        const lines = text.split("\n").filter((line) => line.trim().length > 0);
        expect(lines.length).to.be.greaterThan(
            0,
            "Body should contain at least one log entry"
        );

        // Parse each line as JSON
        const parsedLogs: any[] = [];
        for (const line of lines) {
            try {
                parsedLogs.push(JSON.parse(line));
            } catch (e) {
                throw new Error(`Failed to parse log line as JSON: ${line}`);
            }
        }

        // Assert we have at least 4 logs (the ones we wrote) + 1 crash log entry
        expect(parsedLogs.length).to.be.at.least(
            4,
            "Should have at least 4 log entries"
        );

        // Assert crash log entry exists
        const crashLog = parsedLogs.find(
            (log) =>
                log.component === "CrashHandler" &&
                log.message?.includes("Uncaught rejection") &&
                log.error?.name === "Error" &&
                log.error?.message === "Test crash error"
        );
        expect(crashLog).to.not.be.undefined;

        // Assert logs were cleared after upload
        const remainingLogs = await mockTransport.getAllLogs();
        expect(remainingLogs.length).to.equal(
            0,
            "Logs should be cleared after upload"
        );
    });

    it("should handle uncaught exceptions with uncompressed logs", async function () {
        // Create mock transport
        const mockTransport = new MockStorageTransport({
            format: winston.format.json()
        });

        // Create logger with ONLY the mock transport
        const logger = winston.createLogger({
            level: "debug",
            transports: [mockTransport]
        });

        // Create crash upload config

        // Write some logs
        logger.info("Pre-crash log", { component: "TestComponent" });

        // Wait for async log processing
        await new Promise((resolve) => setImmediate(resolve));

        // Set up crash handler and get handle function
        const crashHandler = setupCrashHandler(logger, loggingConfig);
        expect(crashHandler).to.not.be.undefined;

        // Call handler directly
        const testError = new Error("Test uncaught exception");
        await crashHandler!.handle(testError, "exception");

        // Assert fetch was called
        expect(uploads.length).to.equal(1, "fetch should be called");

        // Assert compression fallback: no Content-Encoding, .ndjson filename
        const headers = uploads[0].headers as Record<string, string>;
        expect(headers["Content-Encoding"]).to.be.undefined;
        expect(headers["X-Filename"]).to.match(/^crash-\d+-[a-z0-9]+\.ndjson$/);

        // Read blob content (uncompressed)
        const blob = uploads[0].body as Blob;
        const text = await blob.text();
        const lines = text.split("\n").filter((line) => line.trim().length > 0);
        const parsedLogs = lines.map((line) => JSON.parse(line));

        // Assert crash log entry exists for exception
        const crashLog = parsedLogs.find(
            (log) =>
                log.component === "CrashHandler" &&
                log.message?.includes("Uncaught exception") &&
                log.error?.message === "Test uncaught exception"
        );
        expect(crashLog).to.not.be.undefined;
    });

    it("should compress logs when CompressionStream is available", async function () {
        // Mock CompressionStream - pass-through transformer
        // Note: We're not testing gzip correctness, just that compression path is taken
        // This mock ensures the compression code path executes and sets correct headers
        class MockCompressionStream {
            readable: ReadableStream;
            writable: WritableStream;

            constructor(format: string) {
                // Create a pass-through transform stream
                // In real implementation, this would compress with gzip
                const transform = new TransformStream({
                    transform(
                        chunk: any,
                        controller: TransformStreamDefaultController
                    ) {
                        controller.enqueue(chunk);
                    }
                });
                this.readable = transform.readable;
                this.writable = transform.writable;
            }
        }

        (global as any).CompressionStream = MockCompressionStream;

        // Create mock transport
        const mockTransport = new MockStorageTransport({
            format: winston.format.json()
        });

        // Create logger with ONLY the mock transport
        const logger = winston.createLogger({
            level: "debug",
            transports: [mockTransport]
        });

        // Create crash upload config

        // Write some logs
        logger.info("Test log", { component: "TestComponent" });

        // Wait for async log processing
        await new Promise((resolve) => setImmediate(resolve));

        // Set up crash handler and get handle function
        const crashHandler = setupCrashHandler(logger, loggingConfig);
        expect(crashHandler).to.not.be.undefined;

        // Call handler directly
        const testError = new Error("Test compressed crash");
        await crashHandler!.handle(testError, "rejection");

        // Assert fetch was called
        expect(uploads.length).to.equal(1, "fetch should be called");

        // Assert compression headers when CompressionStream is available
        const headers = uploads[0].headers as Record<string, string>;
        expect(headers["Content-Encoding"]).to.equal("gzip");
        expect(headers["X-Filename"]).to.match(
            /^crash-\d+-[a-z0-9]+\.ndjson\.gz$/
        );

        // Body should be a Blob (binary when compressed)
        const blob = uploads[0].body as Blob;
        expect(blob).to.be.instanceof(Blob);
        // Note: We don't parse compressed data via .text() - it's binary

        // Cleanup
        delete (global as any).CompressionStream;
    });

    it("uploads logs when crash handler is triggered via Node's 'unhandledRejection' event", async function () {
        const mockTransport = new MockStorageTransport({
            format: winston.format.json()
        });

        const logger = winston.createLogger({
            level: "debug",
            transports: [mockTransport]
        });

        // Set up crash handler (registers process event listeners)
        setupCrashHandler(logger, loggingConfig);

        // Write logs
        logger.info("Integration test log", { component: "TestComponent" });

        // Wait for async log processing
        await new Promise((resolve) => setImmediate(resolve));

        // Trigger via process.emit (integration test)
        const testError = new Error("Integration test error");
        const rejectionPromise = Promise.reject(testError);
        process.emit("unhandledRejection", testError, rejectionPromise);

        // Wait for async handler
        const startTime = Date.now();
        const timeout = 2000;
        while (uploads.length === 0 && Date.now() - startTime < timeout) {
            await new Promise((resolve) => setTimeout(resolve, 50));
        }

        // Assert upload occurred
        expect(uploads.length).to.equal(
            1,
            "fetch should be called via process.emit"
        );

        // Assert compression fallback (CompressionStream is undefined)
        const headers = uploads[0].headers as Record<string, string>;
        expect(headers["Content-Encoding"]).to.be.undefined;
        expect(headers["X-Filename"]).to.match(/^crash-\d+-[a-z0-9]+\.ndjson$/);
    });
});
