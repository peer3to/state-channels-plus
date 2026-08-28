import { Address } from "@/types/types";
import Clock from "@/Clock";
import type { LogUploader, LogUploadOutcome } from "./LogUploader";
import type { LogStore } from "./logStore";
import { LoggerUtils } from "../LoggerUtils";
import { DetachedPromises } from "../DetachedPromises";
import { emptyFlushResult } from "./logControl";
import type {
    LogControlPort,
    LogFlushResult,
    LogPortHandle
} from "./logControl";
import type { LogFlushBus } from "./LogFlushBus";

// The context exclusive to each logger
export type ExclusiveLoggerContext = {
    component?: string;
    [key: string]: any;
};

export type LogThreadName = "main" | "sdk" | "vm";

//The context shared among all child loggers
export type SharedLoggerContext = {
    peerId?: number;
    peerAddress?: Address;
    channelId?: string;
    threadName?: LogThreadName;
};

export type LogLevel = "debug" | "info" | "warn" | "error" | "verbose";

export type LogEntry = {
    time: string;
    // the only axis that orders three realms. `time` is chain-adjusted in sdk
    // and raw in vm -> not comparable across them.
    wallTimeMs: number;
    level: LogLevel;
    context: ExclusiveLoggerContext;
    sharedContext: SharedLoggerContext;
    message: string;
    meta: any[]; // Additional metadata
    stack: string;
};

export type LoggerDestroyOptions = {
    cascadeChildren?: boolean;
    cascadeParent?: boolean;
};

export type LoggerPerformanceMonitorOptions = {
    intervalMs?: number;
    sampleIntervalMs?: number;
    delayWarnThresholdMs?: number;
    delayErrorThresholdMs?: number;
    utilizationWarnThreshold?: number;
    /** Thread label for the event-loop-delay diagnostic reports (default "main"). */
    threadLabel?: string;
};

export abstract class Logger {
    public level?: LogLevel;
    protected context: ExclusiveLoggerContext;
    protected readonly sharedContext: SharedLoggerContext; // shared among all child loggers - imutable reference
    protected logStore: LogStore;
    protected logUploader?: LogUploader;
    protected parent?: Logger;
    protected readonly children: Set<Logger> = new Set();
    private destroyed = false;
    private performanceMonitorStop?: () => void;
    /** set by registerLogger, dropped by dispose */
    private flushBusRegistration?: { bus: LogFlushBus; unregister: () => void };

    constructor(
        context: ExclusiveLoggerContext,
        sharedContext: SharedLoggerContext,
        level: LogLevel | undefined,
        logStore: LogStore,
        logUploader?: LogUploader
    ) {
        this.context = context;
        this.sharedContext = sharedContext;
        this.level = level;
        this.logStore = logStore;
        this.logUploader = logUploader;
    }

    public child(context: ExclusiveLoggerContext): Logger {
        const child = this.createChild({ ...this.context, ...(context || {}) });
        this.linkChild(child);
        return child;
    }

    public updateSharedContext(update: SharedLoggerContext): void {
        const changes = Object.entries(update).filter(
            ([key, value]) =>
                value !== undefined &&
                this.sharedContext[key as keyof SharedLoggerContext] !== value
        );
        // real changes only -> an update that bounces back stops here
        if (changes.length === 0) return;
        Object.assign(this.sharedContext, Object.fromEntries(changes));
        this.flushBus?.postContext(this.rootLogger, update);
    }

    /** owns the store and uploader this one writes through. children share both,
     *  so the bus keys on the root. */
    public get rootLogger(): Logger {
        let logger: Logger = this;
        while (logger.parent) logger = logger.parent;
        return logger;
    }

    public getSharedContext(): Readonly<SharedLoggerContext> {
        return this.sharedContext;
    }

    public isUploadEnabled(): boolean {
        return this.logUploader?.isEnabled() ?? false;
    }

    /** called by registerLogger when this becomes a root */
    public attachFlushBus(bus: LogFlushBus, unregister: () => void): void {
        this.flushBusRegistration?.unregister();
        this.flushBusRegistration = { bus, unregister };
    }

    /** attach a port to an adjacent realm, owned by this logger -> the port lands
     *  on whichever bus this root belongs to. undefined when this logger is on no
     *  bus, so there is no flush tree to join. */
    public addLogPort(port: LogControlPort): LogPortHandle | undefined {
        return this.flushBus?.addPort(port, this);
    }

    /** make `target`'s channel follow this one's, both roots of this realm */
    public followContextTo(target: Logger): () => void {
        return this.flushBus?.followContext(this, target) ?? (() => {});
    }

    /** upload every realm reachable from this one, and report what that achieved */
    public flushAllRealms(reason: string): Promise<LogFlushResult> {
        return (
            this.flushBus?.flushAll(reason) ??
            Promise.resolve(emptyFlushResult())
        );
    }

    /** upload only this realm's store */
    public uploadOwnLogs(): Promise<LogUploadOutcome> {
        return (
            this.logUploader?.uploadLogs() ??
            Promise.resolve({ ok: true, entries: 0 })
        );
    }

    // set by whichever bus registered this root; undefined if none did
    private get flushBus(): LogFlushBus | undefined {
        return this.rootLogger.flushBusRegistration?.bus;
    }

    protected storeLog(logEntry: LogEntry): void {
        this.logStore.store(logEntry);
    }

    public clearLogs(): void {
        this.logStore.clearLogs();
    }

    public dispose(options: LoggerDestroyOptions = {}): void {
        if (this.destroyed) {
            return;
        }

        this.destroyed = true;
        this.stopPerformanceMonitoring();

        if (options.cascadeChildren) {
            for (const child of Array.from(this.children)) {
                child.dispose(options);
            }
        }

        if (options.cascadeParent && this.parent) {
            this.parent.dispose(options);
        }

        this.flushBusRegistration?.unregister();
        this.flushBusRegistration = undefined;
        this.logUploader?.destroy();
        this.unlinkAll();
    }

    private log(level: LogLevel, message: string, meta: any[]): void {
        if (!this.shouldProcessLevel(level)) return;
        const stack = new Error().stack!;

        let timeSeconds: number;
        try {
            timeSeconds = Clock.getTimeInSeconds();
        } catch {
            timeSeconds = Math.floor(Date.now() / 1000);
        }

        const logEntry: LogEntry = {
            time: String(timeSeconds),
            wallTimeMs: Date.now(),
            level,
            message,
            context: this.context,
            sharedContext: this.sharedContext,
            meta: meta,
            stack
        };
        this.write(logEntry);
        this.storeLog(logEntry);
    }

    public debug(message: any, ...meta: any[]): void {
        this.log("debug", message, meta);
    }
    public info(message: any, ...meta: any[]): void {
        this.log("info", message, meta);
    }
    public warn(message: any, ...meta: any[]): void {
        this.log("warn", message, meta);
    }
    public error(message: any, ...meta: any[]): void {
        this.log("error", message, meta);
        const prommise = this.logUploader?.uploadLogs();
        if (prommise) DetachedPromises.collect(prommise);
    }
    public verbose(message: any, ...meta: any[]): void {
        this.log("verbose", message, meta);
    }
    // Directly log an entry without any processing - useful for replaying logs
    public logEntry(logEntry: LogEntry): void {
        this.write(logEntry);
    }

    /** report-a-bug entry point: write the marker, upload every reachable realm,
     *  then record what that round reached and ship that record too */
    public async uploadLogs(
        message: any,
        ...meta: any[]
    ): Promise<LogFlushResult> {
        try {
            await LoggerUtils.logTimestamp(this);
        } catch {
            // no Clock in this realm -> still flush
        }
        const localTime = new Date().getTime() / 1000;
        this.warn(message, ...meta, localTime);
        const result = await this.flushAllRealms(String(message));
        await this.flushBus?.recordRoundResult(String(message), result);
        return result;
    }

    public startPerformanceMonitoring(
        options: LoggerPerformanceMonitorOptions = {}
    ): void {
        this.stopPerformanceMonitoring();
        this.performanceMonitorStop = this.createPerformanceMonitor(options);
    }

    public stopPerformanceMonitoring(): void {
        this.performanceMonitorStop?.();
        this.performanceMonitorStop = undefined;
    }

    private linkChild(child: Logger): void {
        child.parent = this;
        this.children.add(child);
    }

    private unlinkAll(): void {
        const parentRef = this.parent;
        if (parentRef) {
            parentRef.children.delete(this);
            this.parent = undefined;
        }

        for (const child of this.children) {
            if (child.parent === this) {
                child.parent = undefined;
            }
        }
        this.children.clear();
    }

    protected abstract createChild(context: ExclusiveLoggerContext): Logger;
    protected abstract write(logEntry: LogEntry): void;
    protected abstract createPerformanceMonitor(
        options: LoggerPerformanceMonitorOptions
    ): () => void;
    public abstract group(label?: string): void;
    public abstract groupEnd(): void;

    private shouldProcessLevel(level: LogLevel): boolean {
        const levelToPriority = (lvl: LogLevel): number => {
            switch (lvl) {
                case "verbose":
                    return 0;
                case "debug":
                    return 1;
                case "info":
                    return 2;
                case "warn":
                    return 3;
                case "error":
                    return 4;
                default:
                    return 0;
            }
        };
        if (!this.level) return true;
        return levelToPriority(level) >= levelToPriority(this.level);
    }
}
