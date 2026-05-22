import { config, isNodeRuntime } from "../config";
import type {
    ExclusiveLoggerContext,
    SharedLoggerContext,
    LogLevel,
    LoggerDestroyOptions,
    LoggerPerformanceMonitorOptions
} from "./Logger";
import { Logger } from "./Logger";
import { LogStore } from "./logStore";
import type { LogUploader } from "./LogUploader";
import { LogUploaderConfig } from "./LogUploader";
import { NodeLogger } from "./node/NodeLogger";
import { BrowserLogger } from "./browser/BrowserLogger";
import { decodeLogs, decompressFromBase64 } from "./logEncoder";

export type {
    Logger,
    ExclusiveLoggerContext,
    SharedLoggerContext,
    LoggerDestroyOptions,
    LoggerPerformanceMonitorOptions
};
export { decodeLogs, decompressFromBase64 };

export type CreateLoggerOptions = {
    level?: LogLevel;
    skipWriting?: boolean;
    logUploaderConfig?: LogUploaderConfig;
    logUploader?: LogUploader;
    attachErrorListener?: boolean;
    excludedTags?: Set<string>;
};

// Create a logger instance with the given context
export const createLogger = (
    sharedContext: SharedLoggerContext = {},
    exclusiveContext: ExclusiveLoggerContext = {},
    options: CreateLoggerOptions = {}
): Logger => {
    const uploadEnabled = Boolean(config.CRASH_LOG_UPLOAD_ENDPOINT);
    const skipWriting = options.skipWriting ?? config.LOG_SKIP_WRITING;
    const maxSize = (config.CRASH_LOG_MAX_SIZE_MB || 10) * 1024 * 1024;
    const logStore = new LogStore(maxSize, uploadEnabled);

    const logUploaderConfig: LogUploaderConfig =
        options.logUploaderConfig ||
        ({
            uploadEndpoint: config.CRASH_LOG_UPLOAD_ENDPOINT,
            apiToken: config.CRASH_LOG_API_TOKEN || ""
        } as LogUploaderConfig);
    if (!isNodeRuntime()) {
        return new BrowserLogger(
            exclusiveContext,
            sharedContext,
            options.level ?? (config.LOG_LEVEL as LogLevel),
            logStore,
            {
                logUploaderConfig,
                logUploader: options.logUploader,
                attachErrorListener: options.attachErrorListener
            },
            skipWriting
        );
    }

    const logLevel = options.level ?? NodeLogger.parseLogLevelFromArgs();
    const excludedTags =
        options.excludedTags ?? NodeLogger.parseExcludedTagsFromArgs();
    return new NodeLogger(
        exclusiveContext,
        sharedContext,
        logLevel,
        logStore,
        {
            logUploaderConfig: logUploaderConfig,
            logUploader: options.logUploader,
            attachErrorListener: options.attachErrorListener
        },
        excludedTags,
        skipWriting
    );
};
