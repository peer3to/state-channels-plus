import { Address } from "@/types/types";
import Clock from "@/Clock";
import type { LogUploader } from "./LogUploader";
import type { LogStore } from "./logStore";
import { LoggerUtils } from "../LoggerUtils";
import { DetachedPromises } from "../DetachedPromises";

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
};

export type LogLevel = "debug" | "info" | "warn" | "error" | "verbose";

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

export abstract class Logger {
    public level?: LogLevel;
    protected context: ExclusiveLoggerContext;
    protected readonly sharedContext: SharedLoggerContext; // shared among all child loggers - imutable reference
    protected logStore: LogStore;
    protected logUploader?: LogUploader;
    protected parent?: Logger;
    protected readonly children: Set<Logger> = new Set();
    private destroyed = false;

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
        const newSharedContext = { ...this.sharedContext, ...update };
        Object.assign(this.sharedContext, newSharedContext);
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

    public async uploadLogs(message: any, ...meta: any[]): Promise<void> {
        await LoggerUtils.logTimestamp(this);
        const localTime = new Date().getTime() / 1000;
        this.warn(message, ...meta, localTime);
        await this.logUploader?.uploadLogs();
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
