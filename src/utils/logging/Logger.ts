import { Address } from "@/types/types";
import Clock from "@/Clock";
import type { LogUploader } from "./LogUploader";
import type { LogStore } from "./logStore";
import { LoggerUtils } from "../LoggerUtils";
import { DetachedPromises } from "../DetachedPromises";
import type { GossipNode } from "@/utils/GossipNode";

// The context exclusive to each logger
export type ExclusiveLoggerContext = {
    component?: string;
    [key: string]: any;
};

//The context shared among all child loggers
export type SharedLoggerContext = {
    peerId?: number;
    peerAddress?: Address;
    channelId?: string;
    threadName?: string;
};

// Cross-thread ops every logger applies to its own state; carried opaquely by GossipNode.
export type LoggerOp =
    | { type: "flush" }
    | { type: "updateContext"; context: SharedLoggerContext };

export type LogLevel = "debug" | "info" | "warn" | "error" | "verbose";

// Recipe to rebuild an equivalent logger on a worker thread (a live Logger can't be cloned).
export type SerializableLoggerConfig = {
    sharedContext: SharedLoggerContext;
    uploadEndpoint: string;
    apiToken: string;
    level?: string;
    skipWriting?: boolean;
};

export type LogEntry = {
    time: string;
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
};

export abstract class Logger {
    public level?: LogLevel;
    protected context: ExclusiveLoggerContext;
    protected readonly sharedContext: SharedLoggerContext; // shared among all child loggers - imutable reference
    protected logStore: LogStore;
    protected logUploader?: LogUploader;
    protected readonly skipWriting: boolean;
    protected parent?: Logger;
    protected readonly children: Set<Logger> = new Set();
    private node?: GossipNode;
    private destroyed = false;
    private performanceMonitorStop?: () => void;

    constructor(
        context: ExclusiveLoggerContext,
        sharedContext: SharedLoggerContext,
        level: LogLevel | undefined,
        logStore: LogStore,
        logUploader?: LogUploader,
        skipWriting: boolean = false
    ) {
        this.context = context;
        this.sharedContext = sharedContext;
        this.level = level;
        this.logStore = logStore;
        this.logUploader = logUploader;
        this.skipWriting = skipWriting;
    }

    public toSerializableConfig(overrides: {
        threadName: string;
    }): SerializableLoggerConfig {
        const uploaderConfig = this.logUploader?.getConfig();
        return {
            sharedContext: { ...this.sharedContext, ...overrides },
            uploadEndpoint: uploaderConfig?.uploadEndpoint ?? "",
            apiToken: uploaderConfig?.apiToken ?? "",
            level: this.level,
            skipWriting: this.skipWriting
        };
    }

    public child(context: ExclusiveLoggerContext): Logger {
        const child = this.createChild({ ...this.context, ...(context || {}) });
        this.linkChild(child);
        return child;
    }

    public updateSharedContext(update: SharedLoggerContext): void {
        this.applyOp({ type: "updateContext", context: update });
        this.resolveGossipNode()?.broadcast({
            type: "updateContext",
            context: update
        });
    }

    public setGossipNode(node: GossipNode): void {
        this.node = node;
    }

    // Walk up to the nearest ancestor holding the node. Posting to a disposed
    // worker's port is a silent no-op, so callers need no guard.
    private resolveGossipNode(): GossipNode | undefined {
        let logger: Logger | undefined = this;
        while (logger) {
            if (logger.node) return logger.node;
            logger = logger.parent;
        }
        return undefined;
    }

    // Single interpreter for a LoggerOp on this thread; returns the flush promise
    // so local callers can await/detach it.
    public applyOp(op: LoggerOp): Promise<void> | void {
        switch (op.type) {
            case "flush":
                return this.logUploader?.uploadLogs();
            case "updateContext":
                Object.assign(this.sharedContext, op.context);
                return;
        }
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
        // Flush only this thread's own store — NO cross-thread gossip (error() has
        // 60+ call sites; fanning out would re-upload every thread on every error).
        // The report-bug path (uploadLogs) is what pulls all threads.
        const promise = this.applyOp({ type: "flush" }) as
            | Promise<void>
            | undefined;
        if (promise) DetachedPromises.collect(promise);
    }
    public verbose(message: any, ...meta: any[]): void {
        this.log("verbose", message, meta);
    }
    // Directly log an entry without any processing - useful for replaying logs
    public logEntry(logEntry: LogEntry): void {
        this.write(logEntry);
    }

    public async uploadLogs(message: any, ...meta: any[]): Promise<void> {
        // logTimestamp needs a live Clock; the worker has none — don't abort the flush.
        try {
            await LoggerUtils.logTimestamp(this);
        } catch {
            /* no Clock on this thread — skip the timestamp diagnostic */
        }
        const localTime = new Date().getTime() / 1000;
        this.warn(message, ...meta, localTime);
        await this.flushUploads();
    }

    // Local flush + cross-thread gossip (report-bug path); returns the local promise.
    private flushUploads(): Promise<void> | undefined {
        const own = this.applyOp({ type: "flush" }) as
            | Promise<void>
            | undefined;
        this.resolveGossipNode()?.broadcast({ type: "flush" });
        return own;
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
