import { config } from "../../config";
import {
    type ExclusiveLoggerContext,
    type LogLevel,
    type Logger,
    type SharedLoggerContext
} from "../Logger";
import { LogStore } from "../logStore";
import type { LogUploaderConfig } from "../LogUploader";
import type { CreateLoggerOptions } from "../createLoggerTypes";
import { BrowserLogger } from "./BrowserLogger";

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
