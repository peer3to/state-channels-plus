import type {
    ExclusiveLoggerContext,
    SharedLoggerContext,
    LoggerDestroyOptions,
    LoggerPerformanceMonitorOptions,
    Logger
} from "./Logger";
import { decodeLogs, decompressFromBase64 } from "./logEncoder";
import type { CreateLoggerOptions } from "./createLoggerTypes";
import { LogFlushBus, realmLogFlushBus } from "./LogFlushBus";
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
export type {
    FlushId,
    LogControlMessage,
    LogControlPort,
    LogFlushResult,
    LogPortHandle,
    LogRemoteRealm
} from "./logControl";
export type { LogThreadName } from "./Logger";
export type { LogUploadOutcome } from "./LogUploader";
