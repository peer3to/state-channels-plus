import { config } from "../config";
import type { CreateLoggerOptions } from "./createLoggerTypes";
import { LogStore } from "./logStore";
import type { LogUploaderConfig } from "./LogUploader";

export function buildLoggerFoundation(options: CreateLoggerOptions = {}) {
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

    return { logStore, skipWriting, logUploaderConfig };
}
