// @spec-test-coverage-ignore: browser page script for the worker smokes; evidence is mapped from run-worker-contract-executor.mjs
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

// Parentless browser worker roots created from this page: one whose class
// checks the page's config before the root is built, and two logger-probe
// roots that read the thread name their entry started them with.
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
        index: await probe("index")
    };
};

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
