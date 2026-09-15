import type { CreateLoggerOptions } from "./createLoggerTypes";
import { decodeLogs, decompressFromBase64 } from "./logEncoder";
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
export { decodeLogs, decompressFromBase64 };
export type { LogThreadName } from "./Logger";
export type { LogUploadOutcome } from "./LogUploader";
