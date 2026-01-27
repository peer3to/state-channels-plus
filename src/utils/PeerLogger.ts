import { Logger, LoggerContext } from "./logging/types";
import {
    getGlobalLogger,
    parseLogLevelFromArgs,
    parseExcludedTagsFromArgs
} from "./logging/globalLogger";
import { isNodeRuntime } from "./config";

export class PeerLogger {
    private logger: Logger;

    constructor(level: string | undefined, context: LoggerContext = {}) {
        const globalLogger = getGlobalLogger();

        if (level) {
            globalLogger.level = level;
        }

        this.logger = globalLogger.child(context || {});
    }

    public setLogLevel(level: string): void {
        this.logger.level = level;
    }

    public cleanup(): void {
        this.logger.clear?.();
        this.logger.close?.();
    }

    private log(
        level: string,
        message: string,
        context: LoggerContext = {},
        ...args: any[]
    ): void {
        (this.logger as any)[level](message, context, ...args);
    }

    // Core logging methods
    public debug(
        message: string,
        context: LoggerContext = {},
        ...args: any[]
    ): void {
        this.log("debug", message, context, ...args);
    }

    public info(
        message: string,
        context: LoggerContext = {},
        ...args: any[]
    ): void {
        this.log("info", message, context, ...args);
    }

    public warn(
        message: string,
        context: LoggerContext = {},
        ...args: any[]
    ): void {
        this.log("warn", message, context, ...args);
    }

    public error(
        message: string,
        context: LoggerContext = {},
        ...args: any[]
    ): void {
        this.log("error", message, context, ...args);
    }

    public child(context: LoggerContext): Logger {
        return this.logger.child(context);
    }

    public static parseLogLevelFromArgs(
        args: string[] = isNodeRuntime() ? (process as any).argv : []
    ): string {
        return parseLogLevelFromArgs(args);
    }

    public static parseExcludedTagsFromArgs(
        args: string[] = isNodeRuntime() ? (process as any).argv : []
    ): Set<string> {
        return parseExcludedTagsFromArgs(args);
    }
}

// Exports

// Create a logger instance with the given context
export const createLogger = (context: LoggerContext = {}): Logger => {
    // Use the global singleton logger and create a child with the provided context
    const globalLogger = getGlobalLogger();
    return globalLogger.child(context);
};

export default PeerLogger;
