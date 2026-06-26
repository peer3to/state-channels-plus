/* eslint-disable no-console */
const { DEFAULT_LOG_DIR } = require("./constants");

function parseCliArgs(argv) {
    const options = {
        logDir: DEFAULT_LOG_DIR,
        allowLogdirPurge: false,
        // workers is intentionally left undefined so we can distinguish
        // "user explicitly set it" from "default".
        workers: undefined,
        grep: undefined,
        threadFactor: undefined,
        threadBudget: undefined,
        // targetLoad undefined → use env or built-in constant.
        targetLoad: undefined,
        dryRun: false,
        // Thread-mode toggles: undefined = fall back to env/default in resolveThreadModes.
        sdkThread: undefined,
        vmThread: undefined,
        // Shared discovery: undefined = fall back to env/default (on by default).
        sharedDiscovery: undefined,
        // Per-slot external hardhat node: undefined = fall back to env/default (off by default).
        perSlotNode: undefined,
        // Single shared hardhat node: undefined = fall back to env/default (off by default).
        sharedNode: undefined
    };

    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];

        if (arg === "--grep" || arg === "-g") {
            const next = argv[i + 1];
            if (next && !next.startsWith("-")) {
                options.grep = next;
                i++;
            }
            continue;
        }

        if (arg.startsWith("--grep=")) {
            options.grep = arg.slice("--grep=".length);
            continue;
        }

        if (
            arg === "--logDir" ||
            arg === "--log-dir" ||
            arg === "--dir" ||
            arg === "-d"
        ) {
            const next = argv[i + 1];
            if (next) {
                options.logDir = next;
                i++;
            }
            continue;
        }

        if (
            arg.startsWith("--logDir=") ||
            arg.startsWith("--log-dir=") ||
            arg.startsWith("--dir=") ||
            arg.startsWith("-d=")
        ) {
            options.logDir = arg.split("=").slice(1).join("=");
            continue;
        }

        if (
            arg === "--allowLogdirPurge" ||
            arg === "--allow-logdir-purge" ||
            arg === "--purge" ||
            arg === "-p"
        ) {
            options.allowLogdirPurge = true;
            continue;
        }

        if (arg === "--workers" || arg === "-w") {
            const next = argv[i + 1];
            const parsed = next ? Number.parseInt(next, 10) : NaN;
            if (Number.isFinite(parsed) && parsed > 0) {
                options.workers = parsed;
                i++;
            }
            continue;
        }

        if (arg.startsWith("--workers=") || arg.startsWith("-w=")) {
            const value = arg.split("=").slice(1).join("=");
            const parsed = Number.parseInt(value, 10);
            if (Number.isFinite(parsed) && parsed > 0) {
                options.workers = parsed;
            }
            continue;
        }

        if (arg === "--thread-factor" || arg === "-F") {
            const next = argv[i + 1];
            const parsed = next ? Number.parseFloat(next) : NaN;
            if (Number.isFinite(parsed) && parsed > 0) {
                options.threadFactor = parsed;
                i++;
            }
            continue;
        }

        if (arg.startsWith("--thread-factor=") || arg.startsWith("-F=")) {
            const value = arg.split("=").slice(1).join("=");
            const parsed = Number.parseFloat(value);
            if (Number.isFinite(parsed) && parsed > 0) {
                options.threadFactor = parsed;
            }
            continue;
        }

        if (arg.startsWith("--thread-budget=")) {
            const value = arg.split("=").slice(1).join("=");
            const parsed = Number.parseInt(value, 10);
            if (Number.isFinite(parsed) && parsed > 0) {
                options.threadBudget = parsed;
            }
            continue;
        }

        if (arg === "--thread-budget") {
            const next = argv[i + 1];
            const parsed = next ? Number.parseInt(next, 10) : NaN;
            if (Number.isFinite(parsed) && parsed > 0) {
                options.threadBudget = parsed;
                i++;
            }
            continue;
        }

        if (arg === "--sdk-thread") {
            options.sdkThread = true;
            continue;
        }

        if (arg === "--no-sdk-thread") {
            options.sdkThread = false;
            continue;
        }

        if (arg === "--vm-thread") {
            options.vmThread = true;
            continue;
        }

        if (arg === "--no-vm-thread") {
            options.vmThread = false;
            continue;
        }

        if (arg === "--shared-discovery") {
            options.sharedDiscovery = true;
            continue;
        }

        if (arg === "--no-shared-discovery") {
            options.sharedDiscovery = false;
            continue;
        }

        if (arg === "--per-slot-node") {
            options.perSlotNode = true;
            continue;
        }

        if (arg === "--no-per-slot-node") {
            options.perSlotNode = false;
            continue;
        }

        if (arg === "--shared-node") {
            options.sharedNode = true;
            continue;
        }

        if (arg === "--no-shared-node") {
            options.sharedNode = false;
            continue;
        }

        if (arg === "--dry-run") {
            options.dryRun = true;
            continue;
        }

        if (arg === "--target-load") {
            const next = argv[i + 1];
            const parsed = next ? Number.parseFloat(next) : NaN;
            if (Number.isFinite(parsed) && parsed > 0) {
                options.targetLoad = parsed;
                i++;
            }
            continue;
        }

        if (arg.startsWith("--target-load=")) {
            const value = arg.split("=").slice(1).join("=");
            const parsed = Number.parseFloat(value);
            if (Number.isFinite(parsed) && parsed > 0) {
                options.targetLoad = parsed;
            }
            continue;
        }
    }

    return options;
}

module.exports = { parseCliArgs };
