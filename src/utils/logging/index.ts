import type { CreateLoggerOptions } from "./createLoggerTypes";
import { decodeLogs, decompressFromBase64 } from "./logEncoder";
import { LogFlushBus, realmLogFlushBus } from "./LogFlushBus";
import type {
    ExclusiveLoggerContext,
    SharedLoggerContext,
    LoggerDestroyOptions,
    LoggerPerformanceMonitorOptions,
    Logger
} from "./Logger";
export { createLogger } from "@platform/createLogger";

export type {
    Logger,
    ExclusiveLoggerContext,
    SharedLoggerContext,
    LoggerDestroyOptions,
    LoggerPerformanceMonitorOptions,
    CreateLoggerOptions
};
export { decodeLogs, decompressFromBase64, LogFlushBus, realmLogFlushBus };
export type { LogFlushResult } from "./LogFlushBus";
export type { LogThreadName } from "./Logger";
export type { LogUploadOutcome } from "./LogUploader";
