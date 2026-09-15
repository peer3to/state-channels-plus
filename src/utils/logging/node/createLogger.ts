import { buildLoggerFoundation } from "../createLoggerFoundation";
import type { CreateLoggerOptions } from "../createLoggerTypes";
import {
    type ExclusiveLoggerContext,
    type LogLevel,
    type Logger,
    type SharedLoggerContext
} from "../Logger";
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
        threadName: sharedContext.threadName ?? globalThis.threadName
    };
    const { logStore, skipWriting, logUploaderConfig } =
        buildLoggerFoundation(options);

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
    if (options.loggerService)
        logger.attachLoggerService(options.loggerService);
    return logger;
};
