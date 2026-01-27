// Public API exports
import { getGlobalLogger } from "./globalLogger";
import type { Logger, LoggerContext } from "./types";

export type { Logger, LoggerContext };

// Create a logger instance with the given context
export const createLogger = (context: LoggerContext = {}): Logger => {
    // Use the global singleton logger and create a child with the provided context
    const globalLogger = getGlobalLogger();
    return globalLogger.child(context);
};
