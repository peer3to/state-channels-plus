import type { LogLevel } from "./Logger";
import type { LogUploader, LogUploaderConfig } from "./LogUploader";

export type CreateLoggerOptions = {
    level?: LogLevel;
    skipWriting?: boolean;
    logUploaderConfig?: LogUploaderConfig;
    logUploader?: LogUploader;
    attachErrorListener?: boolean;
    excludedTags?: Set<string>;
};
