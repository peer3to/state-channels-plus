export {
    StructuredLogger,
    ContextProvider,
    LogContext
} from "./StructuredLogger";
export { LogEvent, LogEventType } from "./LogEvents";
export {
    LoggingConfig,
    LoggingMode,
    MemoryStorageConfig,
    CrashUploadConfig,
    createWinstonLogger,
    createLoggerConfig,
    createAutoConfig,
    detectLoggingMode,
    loggingConfigs as defaultConfigs
} from "./LoggingConfig";
export { setupCrashHandler } from "./CrashHandler";

import winston from "winston";
import {
    createWinstonLogger,
    createAutoConfig,
    LoggingConfig
} from "./LoggingConfig";
import { StructuredLogger, ContextProvider } from "./StructuredLogger";
import { setupCrashHandler } from "./CrashHandler";

// Re-export Winston Logger type for convenience
export type Logger = winston.Logger;

// Global Winston instance
let globalWinston: winston.Logger | null = null;
let globalConfig: LoggingConfig | null = null;

export function initLogging(): LoggingConfig {
    globalConfig = createAutoConfig();
    globalWinston = createWinstonLogger(globalConfig);

    // Setup crash handler if crash upload is configured
    if (globalConfig.crashUpload?.enabled) {
        setupCrashHandler(globalWinston, globalConfig);
    }

    // Log initialization (only if console enabled)
    if (globalConfig.console && globalConfig.enabled) {
        console.log(
            `[Logging] Initialized: mode=${globalConfig.mode}, level=${globalConfig.level}`
        );
    }

    return globalConfig;
}

/**
 * Initialize with explicit config
 */
export function initLoggingWithConfig(config: LoggingConfig): void {
    globalConfig = config;
    globalWinston = createWinstonLogger(config);

    // Setup crash handler if crash upload is configured
    if (config.crashUpload?.enabled) {
        setupCrashHandler(globalWinston, config);
    }
}

/**
 * Get the global Winston logger instance
 * Auto-initializes with defaults if not yet initialized
 */
export function getGlobalLogger(): winston.Logger {
    if (!globalWinston) {
        initLogging();
    }
    return globalWinston!;
}

export function createStructuredLogger(
    component: string,
    contextProvider?: ContextProvider
): StructuredLogger {
    return new StructuredLogger(getGlobalLogger(), component, contextProvider);
}

/**
 * @deprecated Use createStructuredLogger() instead
 */
export function createLogger(
    component: string,
    contextProvider?: ContextProvider
): StructuredLogger {
    return createStructuredLogger(component, contextProvider);
}
