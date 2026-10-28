// @spec-test-coverage-ignore: browser page script for the worker smokes; evidence is mapped from run-worker-contract-executor.mjs
import { waitForPlain } from "../utils/waitForPlain.js";
import { Buffer } from "buffer";
import { ethers } from "ethers";

globalThis.Buffer ||= Buffer;
globalThis.window ||= globalThis;

// Registers the watchdog smoke on the same page.
import "./worker-watchdog.js";

const { createBrowserSdkExecutor } = await import("./sdkSetup.js");

const CUSTOM_ADDRESS = "0x00000000000000000000000000000000000000bb";

globalThis.runContractExecutorWorkerBrowserSmoke = async () => {
    const sdk = await createBrowserSdkExecutor({
        customPrecompiles: [
            {
                address: CUSTOM_ADDRESS,
                module: new URL("./worker-precompile.js", import.meta.url).href,
                options: {
                    expectedData: "0x1234",
                    value: "42"
                }
            }
        ]
    });
    const { executor } = sdk;

    try {
        const result = await executor.simulateCall("0x1234", CUSTOM_ADDRESS);
        const [value, isWorker] = ethers.AbiCoder.defaultAbiCoder().decode(
            ["uint256", "bool"],
            result.returnValue
        );

        return {
            isWorker,
            value: value.toString()
        };
    } finally {
        await sdk.dispose();
    }
};

// One executor per failure: its vm worker lets each failure escape once,
// and the report arrives as one detached error.
globalThis.runWorkerNonErrorReportBrowserSmoke = async () => {
    const reportOf = async (failure) => {
        const signalName = `non-error-${crypto.randomUUID()}`;
        const reports = [];
        const sdk = await createBrowserSdkExecutor({
            customPrecompiles: [
                {
                    address: CUSTOM_ADDRESS,
                    module: new URL("./worker-precompile.js", import.meta.url)
                        .href,
                    options: {
                        expectedData: "0x",
                        value: "42",
                        nonErrorSignal: signalName
                    }
                }
            ],
            dependencies: { onDetachedError: (error) => reports.push(error) }
        });
        const signal = new BroadcastChannel(signalName);
        try {
            // The call loads the precompile, so its channel listens.
            await sdk.executor.simulateCall("0x", CUSTOM_ADDRESS);
            signal.postMessage(failure);
            await waitForPlain(() => reports.length >= 1, 15_000, 50);
            await sdk.executor.simulateCall("0x", CUSTOM_ADDRESS);
            return {
                messages: reports.map((report) => report.message),
                isServing: true
            };
        } finally {
            signal.close();
            await sdk.dispose();
        }
    };
    return {
        errorEventWithoutError: await reportOf("error-event-without-error"),
        thrownString: await reportOf("thrown-string")
    };
};

// Runtime code: TIMESTAMP, MSTORE at 0, RETURN 32 bytes; the init code
// returns those nine bytes.
const TIMESTAMP_INIT_CODE = "0x684260005260206000f3600052600960" + "17f3";

// The browser worker builds the host's clock perception from the adjustment
// it receives at initialization: block.timestamp is wall time plus the host
// Clock's adjustment, and it advances.
globalThis.runContractExecutorWorkerClockBrowserSmoke = async () => {
    const adjustmentSeconds = 600;
    const sdk = await createBrowserSdkExecutor({
        clockAdjustmentSeconds: adjustmentSeconds
    });
    const { executor } = sdk;
    try {
        const deployed = await executor.deploy(TIMESTAMP_INIT_CODE);
        const address = String(deployed.createdAddress);
        const read = async () =>
            Number(
                BigInt((await executor.executeCall("0x", address)).returnValue)
            );
        const wallBefore = Math.floor(Date.now() / 1000);
        const first = await read();
        const wallAfter = Math.floor(Date.now() / 1000);
        await new Promise((resolve) => setTimeout(resolve, 1100));
        const second = await read();
        return {
            hostAdjustmentSeconds: sdk.clockAdjustmentSeconds,
            firstOffsetLowerBound: first - wallAfter,
            firstOffsetUpperBound: first - wallBefore,
            advanced: second > first
        };
    } finally {
        await sdk.dispose();
    }
};

// Exercise the shared reporter with a browser-only long-task threshold input.
globalThis.runBrowserPerformanceReportingSmoke = async () => {
    const { BrowserLogger } = await import(
        "../../src/utils/logging/browser/BrowserLogger.ts"
    );
    const { LogStore } = await import("../../src/utils/logging/logStore.ts");
    const { reportPerformanceSample } = await import(
        "../../src/utils/logging/performanceMonitorInternal.ts"
    );
    const store = new LogStore(1024 * 1024, true);
    const logger = new BrowserLogger(
        {},
        {},
        "verbose",
        store,
        { attachErrorListener: false },
        true
    );
    try {
        const details = reportPerformanceSample(
            logger,
            {
                dMean: 1,
                d50: 1,
                d90: 1,
                d99: 1,
                dMax: 1,
                utilization: 0.1,
                longTaskMax: 201
            },
            { delayWarnThresholdMs: 100, delayErrorThresholdMs: 200 },
            "browser"
        );
        return { details, entries: store.getAllLogs() };
    } finally {
        logger.dispose();
    }
};

// Render one info line per thread name through the real browser logger. The
// console sink is captured for those writes only; the rendered text is the
// format string without its %c markers, then every argument after the styles.
globalThis.runBrowserLoggerThreadLabelSmoke = async () => {
    const { BrowserLogger } = await import(
        "../../src/utils/logging/browser/BrowserLogger.ts"
    );
    const { LogStore } = await import("../../src/utils/logging/logStore.ts");
    const {
        THREAD_LABEL_COMPONENT,
        THREAD_LABEL_MESSAGE,
        expectedThreadLabelLine,
        threadLabelSharedContext
    } = await import("../fixtures/logging/ThreadLabelExpectation.ts");
    const render = (threadName) => {
        const logger = new BrowserLogger(
            { component: THREAD_LABEL_COMPONENT },
            threadLabelSharedContext(threadName),
            "info",
            new LogStore(1024 * 1024, false)
        );
        const lines = [];
        const { groupCollapsed, groupEnd, info } = console;
        console.groupCollapsed = (format, ...rest) => {
            const styles = (format.match(/%c/g) ?? []).length;
            lines.push(
                [format.replace(/%c/g, ""), ...rest.slice(styles)].join(" ")
            );
        };
        // The stack line inside the group is not under test.
        console.info = () => {};
        console.groupEnd = () => {};
        try {
            logger.info(THREAD_LABEL_MESSAGE);
        } finally {
            Object.assign(console, { groupCollapsed, groupEnd, info });
            logger.dispose();
        }
        return lines;
    };
    const cases = [
        [undefined, "main"],
        ["main", "main"],
        ["sdk", "sdk"],
        ["vm", "vm"],
        ["prover", "prover"]
    ];
    return cases.map(([threadName, label]) => {
        const lines = render(threadName);
        return {
            threadName: threadName ?? null,
            lines,
            matches:
                lines.length === 1 &&
                expectedThreadLabelLine(label).test(lines[0])
        };
    });
};

// The WASM a fresh worker creates while importing one package entry.
globalThis.runInternalRootWasmBrowserSmoke = async () => {
    const probe = (entry) =>
        new Promise((resolve, reject) => {
            const worker = new Worker(
                new URL("./internal-root-wasm-probe.js", import.meta.url),
                { type: "module" }
            );
            worker.onmessage = ({ data }) => {
                worker.terminate();
                if (data.error) reject(new Error(data.error));
                else resolve(data);
            };
            worker.onerror = (event) => {
                worker.terminate();
                reject(new Error(event.message || "probe worker failed"));
            };
            worker.postMessage(entry);
        });
    return {
        internalRoot: await probe("internal-root"),
        relay: await probe("relay")
    };
};

// Parentless browser worker roots created from this page: one whose class
// checks the page's config before the root is built, and two logger-probe
// roots that read the thread name their entry started them with.
globalThis.runWorkerRootBootstrapBrowserSmoke = async () => {
    const { createRoot } = await import("../../src/rpc/internal/createRoot.ts");
    const { ContractExecutorRoot } = await import(
        "../../src/rpc/internal/roots/ContractExecutorRoot.ts"
    );
    const { config, createConfig } = await import("../../src/utils/config.ts");
    const { BOOTSTRAP_CONFIG_MARKER_MB } = await import(
        "../fixtures/workerRoot/BootstrapConfigMarker.ts"
    );
    const { LoggerProbeExecutorRoot } = await import(
        "../fixtures/workerRoot/LoggerProbeExecutorRoot.ts"
    );
    const entry = (file) =>
        new URL(`../fixtures/workerRoot/${file}`, import.meta.url);
    const threadNameOf = async (file) => {
        const handle = await createRoot(LoggerProbeExecutorRoot, {
            mode: "worker",
            workerUrl: entry(file),
            args: { customPrecompiles: [] }
        });
        try {
            return (await handle.rpc.loggerProbe.context().request())
                .threadName;
        } finally {
            await handle.dispose();
        }
    };
    const before = { ...config };
    createConfig({
        ...before,
        CRASH_LOG_MAX_SIZE_MB: BOOTSTRAP_CONFIG_MARKER_MB
    });
    let bootstrapped = false;
    try {
        const handle = await createRoot(ContractExecutorRoot, {
            mode: "worker",
            workerUrl: entry("BootstrapConfigRootEntry.ts"),
            args: { customPrecompiles: [] }
        });
        bootstrapped = true;
        await handle.dispose();
    } finally {
        createConfig(before);
    }
    return {
        bootstrapped,
        named: await threadNameOf("NamedLoggerProbeRootEntry.ts"),
        unnamed: await threadNameOf("UnnamedLoggerProbeRootEntry.ts")
    };
};

// Browser worker roots whose script cannot run: one 404s, one whose requests
// the runner aborts (its diagnostic fetch fails too), one fails to parse, one
// fails to parse and then changes on the server, one throws at top level.
// Each creation rejects; the page returns the error message and the owner's
// "Root worker failed" log lines.
globalThis.runWorkerLoadFailureBrowserSmoke = async () => {
    const { createRoot } = await import("../../src/rpc/internal/createRoot.ts");
    const { ContractExecutorRoot } = await import(
        "../../src/rpc/internal/roots/ContractExecutorRoot.ts"
    );
    const { BrowserLogger } = await import(
        "../../src/utils/logging/browser/BrowserLogger.ts"
    );
    const { LogStore } = await import("../../src/utils/logging/logStore.ts");
    const failure = async (workerUrl) => {
        const store = new LogStore(1024 * 1024, true);
        const logger = new BrowserLogger(
            {},
            {},
            "verbose",
            store,
            { attachErrorListener: false },
            true
        );
        try {
            const handle = await createRoot(ContractExecutorRoot, {
                mode: "worker",
                workerUrl,
                args: { customPrecompiles: [] },
                logger
            });
            await handle.dispose();
            return { created: true };
        } catch (error) {
            return {
                message: error.message,
                logs: store
                    .getAllLogs()
                    .filter((entry) => entry.message === "Root worker failed")
                    .map((entry) => ({
                        level: entry.level,
                        meta: entry.meta[0]
                    }))
            };
        } finally {
            logger.dispose();
        }
    };
    const missingUrl = new URL("./missing-worker-entry.js", import.meta.url)
        .href;
    const abortedUrl = new URL("./aborted-worker-entry.js", import.meta.url)
        .href;
    const unparsableUrl = new URL(
        "./unparsable-worker-entry.js",
        import.meta.url
    ).href;
    const changedUrl = new URL("./changed-worker-entry.js", import.meta.url)
        .href;
    const throwingUrl = URL.createObjectURL(
        new Blob(['throw new Error("browser worker top-level throw");'], {
            type: "text/javascript"
        })
    );
    try {
        return {
            missingUrl,
            missing: await failure(missingUrl),
            abortedUrl,
            aborted: await failure(abortedUrl),
            unparsableUrl,
            unparsable: await failure(unparsableUrl),
            changedUrl,
            changed: await failure(changedUrl),
            throwingUrl,
            throwing: await failure(throwingUrl)
        };
    } finally {
        URL.revokeObjectURL(throwingUrl);
    }
};

// The worker's upload jitter, pinned: an upload still in this wait is pending
// when a disposal without the drain terminates the worker, so the marker is
// lost. Far above the error-to-terminate time, far below the flush bound.
const DRAIN_UPLOAD_JITTER_MS = 1_000;

// A ready browser worker root writes one error-level line and is disposed at
// once; its upload, still in its jitter wait, must reach the endpoint first.
globalThis.runWorkerDrainBrowserSmoke = async (
    uploadEndpoint,
    channelId,
    marker
) => {
    const { createRoot } = await import("../../src/rpc/internal/createRoot.ts");
    const { config } = await import("../../src/utils/config.ts");
    const { LoggerProbeExecutorRoot } = await import(
        "../fixtures/workerRoot/LoggerProbeExecutorRoot.ts"
    );
    const { applyCrashLogConfig } = await import(
        "../fixtures/logging/crashLogConfig.ts"
    );
    const restoreConfig = applyCrashLogConfig({
        CRASH_LOG_UPLOAD_ENDPOINT: uploadEndpoint
    });
    try {
        const handle = await createRoot(LoggerProbeExecutorRoot, {
            mode: "worker",
            workerUrl: new URL(
                "../fixtures/workerRoot/NamedLoggerProbeRootEntry.ts",
                import.meta.url
            ),
            args: { customPrecompiles: [] }
        });
        let disposeMs;
        try {
            await handle.rpc.loggerProbe.updateContext({ channelId }).request();
            await handle.rpc.loggerProbe
                .pinUploadJitter(DRAIN_UPLOAD_JITTER_MS)
                .request();
            await handle.rpc.loggerProbe.error(marker).request();
        } finally {
            const startedAt = Date.now();
            await handle.dispose();
            disposeMs = Date.now() - startedAt;
        }
        return { disposeMs, flushMs: config.CRASH_LOG_FLUSH_MS };
    } finally {
        restoreConfig();
    }
};

// A browser worker root whose script never starts a root stays not ready;
// disposing its parent terminates it without the drain wait.
globalThis.runNotReadyWorkerDisposalBrowserSmoke = async () => {
    const { createRoot } = await import("../../src/rpc/internal/createRoot.ts");
    const { ContractExecutorRoot } = await import(
        "../../src/rpc/internal/roots/ContractExecutorRoot.ts"
    );
    const { config } = await import("../../src/utils/config.ts");
    const idleUrl = URL.createObjectURL(
        new Blob([""], { type: "text/javascript" })
    );
    const parent = await createRoot(ContractExecutorRoot, {
        args: { customPrecompiles: [] }
    });
    try {
        const creation = createRoot(ContractExecutorRoot, {
            parent,
            mode: "worker",
            workerUrl: idleUrl,
            args: { customPrecompiles: [] }
        }).then(
            () => "ready",
            (error) => error.message
        );
        const startedAt = Date.now();
        await parent.dispose();
        return {
            disposeMs: Date.now() - startedAt,
            flushMs: config.CRASH_LOG_FLUSH_MS,
            creation: await creation
        };
    } finally {
        URL.revokeObjectURL(idleUrl);
    }
};

// The parent's flush bound for the drain-timeout case. The child keeps the
// default bound it was bootstrapped with, and its upload waits far longer
// than the parent's drain, so only the parent's bound can end the disposal.
const DRAIN_TIMEOUT_FLUSH_MS = 500;
const DRAIN_TIMEOUT_UPLOAD_JITTER_MS = 10_000;

// A ready browser worker root whose upload outlasts the parent's drain bound:
// the parent warns and terminates it at that bound. With
// `warningWriteError`, the warning's log write throws that message; the page
// returns it as reported uncaught.
globalThis.runWorkerDrainTimeoutBrowserSmoke = async (
    uploadEndpoint,
    channelId,
    warningWriteError
) => {
    const { createRoot } = await import("../../src/rpc/internal/createRoot.ts");
    const { LoggerProbeExecutorRoot } = await import(
        "../fixtures/workerRoot/LoggerProbeExecutorRoot.ts"
    );
    const { applyCrashLogConfig } = await import(
        "../fixtures/logging/crashLogConfig.ts"
    );
    const { BrowserLogger } = await import(
        "../../src/utils/logging/browser/BrowserLogger.ts"
    );
    const { LogStore } = await import("../../src/utils/logging/logStore.ts");
    const restoreConfig = applyCrashLogConfig({
        CRASH_LOG_UPLOAD_ENDPOINT: uploadEndpoint
    });
    const drainWarning =
        "Root worker did not close within the log flush bound; terminating it";
    const store = new LogStore(1024 * 1024, true);
    if (warningWriteError !== undefined) {
        const storeEntry = store.store.bind(store);
        store.store = (entry) => {
            if (entry.message === drainWarning)
                throw new Error(warningWriteError);
            storeEntry(entry);
        };
    }
    const logger = new BrowserLogger(
        {},
        {},
        "verbose",
        store,
        { attachErrorListener: false },
        true
    );
    const reported = [];
    const onReported = (event) => {
        if (
            warningWriteError === undefined ||
            event.error?.message !== warningWriteError
        )
            return;
        event.preventDefault();
        reported.push(event.error.message);
    };
    globalThis.addEventListener("error", onReported);
    try {
        const handle = await createRoot(LoggerProbeExecutorRoot, {
            mode: "worker",
            workerUrl: new URL(
                "../fixtures/workerRoot/NamedLoggerProbeRootEntry.ts",
                import.meta.url
            ),
            args: { customPrecompiles: [] },
            logger
        });
        let disposeMs;
        let restoreFlush = () => {};
        try {
            await handle.rpc.loggerProbe.updateContext({ channelId }).request();
            await handle.rpc.loggerProbe
                .pinUploadJitter(DRAIN_TIMEOUT_UPLOAD_JITTER_MS)
                .request();
            await handle.rpc.loggerProbe
                .error("browser worker drain timeout line")
                .request();
            restoreFlush = applyCrashLogConfig({
                CRASH_LOG_FLUSH_MS: DRAIN_TIMEOUT_FLUSH_MS
            });
        } finally {
            const startedAt = Date.now();
            await handle.dispose();
            disposeMs = Date.now() - startedAt;
            restoreFlush();
        }
        return {
            disposeMs,
            flushMs: DRAIN_TIMEOUT_FLUSH_MS,
            uploadJitterMs: DRAIN_TIMEOUT_UPLOAD_JITTER_MS,
            warnings: store
                .getAllLogs()
                .filter((entry) => entry.message === drainWarning)
                .map((entry) => ({ level: entry.level, meta: entry.meta[0] })),
            reported
        };
    } finally {
        globalThis.removeEventListener("error", onReported);
        logger.dispose();
        restoreConfig();
    }
};

// A browser worker root that throws at top level, owned by a logger whose
// failure line write throws: the root still fails, and the log call's error
// is reported as uncaught.
globalThis.runWorkerFailureLogThrowBrowserSmoke = async () => {
    const { createRoot } = await import("../../src/rpc/internal/createRoot.ts");
    const { ContractExecutorRoot } = await import(
        "../../src/rpc/internal/roots/ContractExecutorRoot.ts"
    );
    const { BrowserLogger } = await import(
        "../../src/utils/logging/browser/BrowserLogger.ts"
    );
    const { LogStore } = await import("../../src/utils/logging/logStore.ts");
    const failureLogWriteError = "browser worker failure log write failed";
    // The store is shared by the logger's children, the root's own logger too.
    const store = new LogStore(1024 * 1024, true);
    const storeEntry = store.store.bind(store);
    store.store = (entry) => {
        if (entry.message === "Root worker failed")
            throw new Error(failureLogWriteError);
        storeEntry(entry);
    };
    const logger = new BrowserLogger(
        {},
        {},
        "verbose",
        store,
        { attachErrorListener: false },
        true
    );
    const reported = [];
    const onReported = (event) => {
        if (event.error?.message !== failureLogWriteError) return;
        event.preventDefault();
        reported.push(event.error.message);
    };
    globalThis.addEventListener("error", onReported);
    const throwingUrl = URL.createObjectURL(
        new Blob(['throw new Error("browser worker top-level throw");'], {
            type: "text/javascript"
        })
    );
    try {
        const message = await createRoot(ContractExecutorRoot, {
            mode: "worker",
            workerUrl: throwingUrl,
            args: { customPrecompiles: [] },
            logger
        }).then(
            async (handle) => {
                await handle.dispose();
                return "created";
            },
            (error) => error.message
        );
        return { message, reported, throwingUrl };
    } finally {
        globalThis.removeEventListener("error", onReported);
        URL.revokeObjectURL(throwingUrl);
        logger.dispose();
    }
};
