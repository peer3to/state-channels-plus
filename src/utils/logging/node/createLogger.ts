import { config } from "@/utils/config";
import {
    type ExclusiveLoggerContext,
    type LogLevel,
    type Logger,
    type SharedLoggerContext
} from "../Logger";
import { LogStore } from "../logStore";
import type { LogUploaderConfig } from "../LogUploader";
import type { CreateLoggerOptions } from "../createLoggerTypes";
import { NodeLogger } from "./NodeLogger";

export const createLogger = (
    sharedContext: SharedLoggerContext = {},
    exclusiveContext: ExclusiveLoggerContext = {},
    options: CreateLoggerOptions = {}
): Logger => {
    const skipWriting = options.skipWriting ?? config.LOG_SKIP_WRITING;
    const maxSize = (config.CRASH_LOG_MAX_SIZE_MB || 10) * 1024 * 1024;

    const logUploaderConfig: LogUploaderConfig =
        options.logUploaderConfig ||
        ({
            uploadEndpoint: config.CRASH_LOG_UPLOAD_ENDPOINT,
            apiToken: config.CRASH_LOG_API_TOKEN || "",
            flushMinIntervalMs: config.CRASH_LOG_FLUSH_MIN_INTERVAL_MS
        } as LogUploaderConfig);

    // Store-enable follows the EFFECTIVE endpoint (injected recipe or global),
    // so the worker — whose global config is DEFAULT_CONFIG — still collects logs.
    const uploadEnabled = Boolean(logUploaderConfig.uploadEndpoint);
    const logStore = new LogStore(maxSize, uploadEnabled);

    const logLevel = options.level ?? NodeLogger.parseLogLevelFromArgs();
    const excludedTags =
        options.excludedTags ?? NodeLogger.parseExcludedTagsFromArgs();
    return new NodeLogger(
        exclusiveContext,
        sharedContext,
        logLevel as LogLevel,
        logStore,
        {
            logUploaderConfig,
            logUploader: options.logUploader,
            attachErrorListener: options.attachErrorListener
        },
        excludedTags,
        skipWriting
    );
};
