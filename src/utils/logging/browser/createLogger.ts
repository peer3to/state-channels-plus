import { config } from "../../config";
import { buildLoggerFoundation } from "../createLoggerFoundation";
import type { CreateLoggerOptions } from "../createLoggerTypes";
import { realmLogFlushBus } from "../LogFlushBus";
import {
    type ExclusiveLoggerContext,
    type LogLevel,
    type Logger,
    type SharedLoggerContext
} from "../Logger";
import { BrowserLogger } from "./BrowserLogger";

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
    const { logStore, skipWriting, logUploaderConfig } =
        buildLoggerFoundation(options);

    const logger = new BrowserLogger(
        exclusiveContext,
        shared,
        options.level ?? (config.LOG_LEVEL as LogLevel),
        logStore,
        {
            logUploaderConfig,
            logUploader: options.logUploader,
            attachErrorListener: options.attachErrorListener
        },
        skipWriting
    );
    // roots only -> a registered child would upload the same store twice
    realmLogFlushBus.registerLogger(logger);
    return logger;
};
