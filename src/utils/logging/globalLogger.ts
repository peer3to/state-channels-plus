import { config, isNodeRuntime } from "../config";
import { setupCrashHandler, CrashUploadConfig } from "./CrashHandler";
import { Logger } from "./types";
import { NodeLogger } from "./node/NodeLogger";
import { BrowserLogger } from "./browser/BrowserLogger";

// Global singleton logger to prevent multiple process event listeners
let globalLogger: Logger | null = null;

// Static helper functions for parsing log configuration
function parseLogLevelFromArgs(
    args: string[] = isNodeRuntime() ? (process as any).argv : []
): string {
    const validLevels = ["verbose", "debug", "info", "warn", "error"];
    let logLevel = "info";

    if (
        config.LOG_LEVEL &&
        validLevels.includes(config.LOG_LEVEL.toLowerCase())
    ) {
        logLevel = config.LOG_LEVEL.toLowerCase();
    }

    const flags = ["--verbose", "--debug", "--info", "--warn", "--error"];
    for (const flag of flags) {
        if (args.includes(flag)) {
            logLevel = flag.substring(2);
            break;
        }
    }

    return logLevel;
}

function parseExcludedTagsFromArgs(
    args: string[] = isNodeRuntime() ? (process as any).argv : []
): Set<string> {
    const excludedTags: Set<string> = new Set();
    const normalize = (tag: string) => tag.trim().toLowerCase();

    const addTags = (value?: string) => {
        if (!value) return;
        value
            .split(/[,\s]+/)
            .map(normalize)
            .filter(Boolean)
            .forEach((tag) => excludedTags.add(tag));
    };

    addTags(config.LOG_EXCLUDE_TAGS);
    addTags(config.EXCLUDE_LOG_TAGS);

    const flagIndex = args.findIndex((arg) => arg === "--exclude-tags");
    if (flagIndex !== -1) {
        addTags(args[flagIndex + 1]);
    }

    const eqFlag = args.find((arg) => arg.startsWith("--exclude-tags="));
    if (eqFlag) {
        addTags(eqFlag.split("=", 2)[1]);
    }

    return excludedTags;
}

export function getGlobalLogger(): Logger {
    if (!globalLogger) {
        if (!isNodeRuntime()) {
            globalLogger = new BrowserLogger(
                {},
                config.LOG_LEVEL,
                config.ENABLE_CRASH_LOG_COLLECTION
            );
            // Set up crash handler for browser
            if (
                config.ENABLE_CRASH_LOG_COLLECTION &&
                config.CRASH_LOG_UPLOAD_ENDPOINT
            ) {
                const crashConfig: CrashUploadConfig = {
                    enabled: true,
                    uploadEndpoint: config.CRASH_LOG_UPLOAD_ENDPOINT,
                    apiToken: config.CRASH_LOG_API_TOKEN || "",
                    prefix: "crash-"
                };
                setupCrashHandler(globalLogger, crashConfig);
            }
            return globalLogger;
        }

        // Create Node.js logger
        const logLevel = parseLogLevelFromArgs();
        const excludedTags = parseExcludedTagsFromArgs();

        const nodeLogger = new NodeLogger(
            {},
            logLevel,
            config.ENABLE_CRASH_LOG_COLLECTION,
            excludedTags
        );

        // Set up crash handler if enabled
        if (config.ENABLE_CRASH_LOG_COLLECTION) {
            const crashConfig: CrashUploadConfig = {
                enabled: true,
                uploadEndpoint: config.CRASH_LOG_UPLOAD_ENDPOINT || "",
                apiToken: config.CRASH_LOG_API_TOKEN || "",
                prefix: "crash-"
            };
            setupCrashHandler(nodeLogger, crashConfig);
        }

        globalLogger = nodeLogger;
    }
    return globalLogger;
}

// Export the static helper functions
export { parseLogLevelFromArgs, parseExcludedTagsFromArgs };
