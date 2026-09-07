import { config } from "../../config";
import { buildLoggerFoundation } from "../createLoggerFoundation";
import type { CreateLoggerOptions } from "../createLoggerTypes";
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
    const { logStore, skipWriting, logUploaderConfig } =
        buildLoggerFoundation(options);

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
};
