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
import { realmLogFlushBus } from "../LogFlushBus";
import { NodeLogger } from "./NodeLogger";

export const createLogger = (
    sharedContext: SharedLoggerContext = {},
    exclusiveContext: ExclusiveLoggerContext = {},
    options: CreateLoggerOptions = {}
): Logger => {
    // copied, not mutated -> two loggers from one literal stay independent.
    // every realm files under a thread role; main is the default.
    const shared: SharedLoggerContext = {
        ...sharedContext,
        threadName: sharedContext.threadName ?? "main"
    };
    const uploadEnabled = Boolean(config.CRASH_LOG_UPLOAD_ENDPOINT);
    const skipWriting = options.skipWriting ?? config.LOG_SKIP_WRITING;
    const maxSize = (config.CRASH_LOG_MAX_SIZE_MB || 10) * 1024 * 1024;
    const logStore = new LogStore(maxSize, uploadEnabled);

    const logUploaderConfig: LogUploaderConfig =
        options.logUploaderConfig ||
        ({
            uploadEndpoint: config.CRASH_LOG_UPLOAD_ENDPOINT,
            apiToken: config.CRASH_LOG_API_TOKEN || "",
            jitterMaxMs: config.CRASH_LOG_UPLOAD_JITTER_MAX_MS
        } as LogUploaderConfig);

    const logLevel = options.level ?? NodeLogger.parseLogLevelFromArgs();
    const excludedTags =
        options.excludedTags ?? NodeLogger.parseExcludedTagsFromArgs();
    const logger = new NodeLogger(
        exclusiveContext,
        shared,
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
    // roots only -> a registered child would upload the same store twice
    realmLogFlushBus.registerLogger(logger);
    return logger;
};
