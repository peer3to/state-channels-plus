import type { LogStore } from "./logStore";
import type { LogUploader, LogUploadOutcome } from "./LogUploader";
import type { PerformanceMonitorInternalOptions } from "./performanceMonitorInternal";
import type { LoggerService } from "../../rpc/internal/services/logger/LoggerService";
import { DetachedPromises } from "../DetachedPromises";
import { LoggerUtils } from "../LoggerUtils";
import Clock from "@/Clock";
import { Address } from "@/types/types";

// The context exclusive to each logger
export type ExclusiveLoggerContext = {
    component?: string;
    [key: string]: any;
};

export type LogThreadName = string;

//The context shared among all child loggers
export type SharedLoggerContext = {
    peerId?: number;
    peerAddress?: Address;
    channelId?: string;
    threadName?: LogThreadName;
    /** Set at the runtime's disposal cut-off: the runtime is being torn down. */
    disposing?: boolean;
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
    private static performanceMonitorStop?: () => void;
    private static performanceMonitorOwner?: Logger;
    // Children share resources even after disposal separates their parent links.
    private sharedResources: {
        loggers: Set<Logger>;
        loggerService?: LoggerService;
    } = { loggers: new Set([this]) };

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
        child.sharedResources = this.sharedResources;
        // a disposed logger's child is born disposed, outside the family
        if (this.destroyed) {
            child.destroyed = true;
            return child;
        }
        this.sharedResources.loggers.add(child);
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
        this.sharedResources.loggerService?.postContext(update);
    }

    /** The current parent at the top of this logger's graph. */
    public get rootLogger(): Logger {
        let logger: Logger = this;
        while (logger.parent) logger = logger.parent;
        return logger;
    }

    public getSharedContext(): Readonly<SharedLoggerContext> {
        return this.sharedContext;
    }

    public get loggerService(): LoggerService | undefined {
        return this.sharedResources.loggerService;
    }

    /** Attach this shared store once; every child uses the same service reference. */
    public attachLoggerService(service: LoggerService): void {
        this.assertActive();
        if (this.loggerService === service) return;
        if (this.loggerService)
            throw new Error(
                "Logger store is already attached to another service"
            );
        service.attachStore(this.logStore, {
            updateContext: (context) => {
                Object.assign(this.sharedContext, context);
            },
            upload: (flushDeadlineMs) =>
                this.logUploader?.uploadLogs(flushDeadlineMs) ??
                Promise.resolve({ ok: true, entries: 0 }),
            detach: () => {
                this.sharedResources.loggerService = undefined;
            }
        });
        this.sharedResources.loggerService = service;
    }

    /** Schedule local uploading and notify the optional service without waiting for neighbours. */
    public upload(reason = "log upload"): Promise<LogUploadOutcome> {
        this.assertActive();
        this.loggerService?.uploadStarted(this.logStore, reason);
        return this.uploadOwnLogs();
    }

    /**
     * Upload this realm's store and every realm reachable through the coordination service
     * now; settles once all have, or within `CRASH_LOG_FLUSH_MS`. It never fails: each realm
     * reports its own flush failures through its root.
     */
    public flushLogs(): Promise<void> {
        this.assertActive();
        const service = this.loggerService;
        if (!service)
            throw new Error(
                "Logger has no coordination service to flush through"
            );
        return service.startFlush();
    }

    /** upload only this realm's store */
    public uploadOwnLogs(): Promise<LogUploadOutcome> {
        return (
            this.logUploader?.uploadLogs() ??
            Promise.resolve({ ok: true, entries: 0 })
        );
    }

    protected storeLog(logEntry: LogEntry): void {
        this.logStore.store(logEntry);
    }

    public clearLogs(): void {
        this.logStore.clearLogs();
    }

    /**
     * True once dispose ran. Logging still writes to the realm's console and
     * stores while a logger of its family lives; it never uploads.
     */
    public get isDisposed(): boolean {
        return this.destroyed;
    }

    public dispose(options: LoggerDestroyOptions = {}): void {
        if (this.destroyed) {
            return;
        }

        this.destroyed = true;
        if (Logger.performanceMonitorOwner === this)
            this.stopPerformanceMonitoring();

        if (options.cascadeChildren) {
            for (const child of Array.from(this.children)) {
                child.dispose(options);
            }
        }

        if (options.cascadeParent && this.parent) {
            this.parent.dispose(options);
        }

        this.sharedResources.loggers.delete(this);
        this.unlinkAll();
        const survivor = this.sharedResources.loggers.values().next().value;
        if (survivor) {
            this.logUploader?.setLogger(survivor);
        } else {
            this.loggerService?.detachStore(this.logStore);
            this.logUploader?.destroy();
        }
    }

    private assertActive(): void {
        if (this.destroyed)
            throw new Error(
                `Logger "${this.context.component ?? this.constructor.name}" has been disposed`
            );
    }

    private log(level: LogLevel, message: string, meta: any[]): void {
        // a disposing runtime's warnings and errors come from its teardown
        if (
            this.sharedContext.disposing &&
            (level === "warn" || level === "error")
        )
            level = "info";
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
        if (this.sharedResources.loggers.size > 0) this.storeLog(logEntry);
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
        if (!this.destroyed && !this.sharedContext.disposing)
            DetachedPromises.collect(this.upload(String(message)));
    }
    public verbose(message: any, ...meta: any[]): void {
        this.log("verbose", message, meta);
    }
    // Directly log an entry without any processing - useful for replaying logs
    public logEntry(logEntry: LogEntry): void {
        this.write(logEntry);
    }

    /** Write the report marker, upload locally and gossip through the optional service. */
    public async uploadLogs(
        message: any,
        ...meta: any[]
    ): Promise<LogUploadOutcome> {
        try {
            await LoggerUtils.logTimestamp(this);
        } catch {
            // no Clock in this realm -> still flush
        }
        const localTime = new Date().getTime() / 1000;
        this.warn(message, ...meta, localTime);
        return this.upload(String(message));
    }

    public startPerformanceMonitoring(
        options: PerformanceMonitorInternalOptions = {}
    ): void {
        if (Logger.performanceMonitorStop || this.destroyed) return;
        Logger.performanceMonitorStop = this.createPerformanceMonitor(options);
        Logger.performanceMonitorOwner = this;
    }

    public stopPerformanceMonitoring(): void {
        const stop = Logger.performanceMonitorStop;
        Logger.performanceMonitorStop = undefined;
        Logger.performanceMonitorOwner = undefined;
        stop?.();
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
                child.parent = parentRef;
                parentRef?.children.add(child);
            }
        }
        this.children.clear();
    }

    protected abstract createChild(context: ExclusiveLoggerContext): Logger;
    protected abstract write(logEntry: LogEntry): void;
    protected abstract createPerformanceMonitor(
        options: PerformanceMonitorInternalOptions
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
