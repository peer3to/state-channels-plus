import type {
    ExclusiveLoggerContext,
    SharedLoggerContext,
    LoggerDestroyOptions,
    LoggerPerformanceMonitorOptions,
    Logger
} from "./Logger";
import { decodeLogs, decompressFromBase64 } from "./logEncoder";
import type { CreateLoggerOptions } from "./createLoggerTypes";
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
