#!/usr/bin/env node

/**
 * Quick test script for crash handler
 * Tests the crash handler without needing to rebuild and run the full app
 */

const path = require("path");

console.log("=".repeat(60));
console.log("🧪 Crash Handler Unit Test");
console.log("=".repeat(60));

// Simulate browser environment
global.Blob = class Blob {
    constructor(parts, options) {
        this.parts = parts;
        this.type = options?.type || "";
        this.size = parts.reduce((acc, p) => acc + (p.length || 0), 0);
    }

    stream() {
        return {
            pipeThrough: () => this
        };
    }
};

global.Response = class Response {
    constructor(body) {
        this.body = body;
    }

    async blob() {
        return this.body;
    }
};

global.CompressionStream = class CompressionStream {
    constructor(format) {
        this.format = format;
    }
};

global.fetch = async (url, options) => {
    console.log("\n📤 Mock fetch called:", {
        url,
        method: options.method,
        headers: options.headers,
        bodySize: options.body?.size
    });

    return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ success: true, filename: "test.ndjson.gz" })
    };
};

global.btoa = (str) => Buffer.from(str).toString("base64");
global.setTimeout = setTimeout;

// Test setup
async function runTests() {
    console.log("\n1️⃣ Creating BrowserLogger...");

    class BrowserLogger {
        constructor(context = {}, level = "debug", enableMemoryStorage = true) {
            this.context = context;
            this.level = level;
            this.enableMemoryStorage = enableMemoryStorage;
            this.logs = [];
            this.currentSize = 0;
            this.maxSize = 10 * 1024 * 1024;
        }

        child(context) {
            return new BrowserLogger(
                { ...this.context, ...(context || {}) },
                this.level,
                this.enableMemoryStorage
            );
        }

        storeLog(level, message, meta) {
            if (!this.enableMemoryStorage) return;

            const logEntry = {
                ts: Date.now(),
                level,
                message:
                    typeof message === "string" ? message : String(message),
                component: this.context.component,
                ...this.context,
                ...(meta && typeof meta === "object" ? meta : {})
            };

            const entrySize =
                JSON.stringify(logEntry, (_key, v) =>
                    typeof v === "bigint" ? v.toString() : v
                ).length * 2;

            this.logs.push({ entry: logEntry, size: entrySize });
            this.currentSize += entrySize;
        }

        getAllLogs() {
            return this.logs.map((item) => item.entry);
        }

        clearLogs() {
            this.logs = [];
            this.currentSize = 0;
        }

        debug(message, meta) {
            this.storeLog("debug", message, meta);
        }
        info(message, meta) {
            this.storeLog("info", message, meta);
        }
        warn(message, meta) {
            this.storeLog("warn", message, meta);
        }
        error(message, meta) {
            this.storeLog("error", message, meta);
        }
    }

    const logger = new BrowserLogger({}, "debug", true);
    console.log("✅ BrowserLogger created");

    console.log("\n2️⃣ Adding test logs...");
    logger.info("Test info message", { test: true });
    logger.warn("Test warning message", { test: true });
    logger.debug("Test debug message", { test: true });
    logger.error("Test error message", {
        test: true,
        bigInt: 123456789012345678901234567890n
    });
    console.log(`✅ Added ${logger.getAllLogs().length} logs to memory`);

    console.log("\n3️⃣ Loading CrashHandler...");
    const {
        setupCrashHandler
    } = require("../dist/src/utils/logging/CrashHandler.js");
    console.log("✅ CrashHandler loaded");

    console.log("\n4️⃣ Setting up crash handler...");
    const config = {
        enabled: true,
        uploadEndpoint: "http://localhost:3001",
        apiToken: "",
        prefix: "test-crash-"
    };

    const result = setupCrashHandler(logger, config);
    console.log("✅ Crash handler setup complete");

    if (!result) {
        console.error(
            "❌ setupCrashHandler returned null - check warnings above"
        );
        process.exit(1);
    }

    console.log("\n5️⃣ Testing child logger...");
    const childLogger = logger.child({
        component: "TestComponent",
        peerId: 123
    });
    childLogger.error("Test error from child logger", { childTest: true });
    console.log("✅ Child logger error called");

    console.log("\n6️⃣ Triggering crash handler manually...");
    const testError = new Error("Test crash error");
    await result.handle(testError, "error-log");
    console.log("✅ Crash handler triggered");

    console.log("\n7️⃣ Waiting for async operations...");
    await new Promise((resolve) => setTimeout(resolve, 1000));
    console.log("✅ Async operations complete");

    console.log("\n" + "=".repeat(60));
    console.log("✅ All tests passed!");
    console.log("=".repeat(60));

    console.log("\n📝 Next steps:");
    console.log(
        "1. Start the crash log server: node scripts/crash-log-server.js"
    );
    console.log("2. Open test-crash-handler.html in your browser");
    console.log("3. Click the test buttons to verify crash handler");
    console.log("4. Check the server logs and crash-logs/ directory");
}

runTests().catch((err) => {
    console.error("\n❌ Test failed:", err);
    console.error(err.stack);
    process.exit(1);
});
