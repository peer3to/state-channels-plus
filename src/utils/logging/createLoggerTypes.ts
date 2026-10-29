import type { LogLevel } from "./Logger";
import type { LogUploader, LogUploaderConfig } from "./LogUploader";
import type { LoggerService } from "@/rpc/internal/services/logger/LoggerService";

export type CreateLoggerOptions = {
    loggerService?: LoggerService;
    level?: LogLevel;
    skipWriting?: boolean;
    logUploaderConfig?: LogUploaderConfig;
    logUploader?: LogUploader;
    attachErrorListener?: boolean;
    excludedTags?: Set<string>;
};
