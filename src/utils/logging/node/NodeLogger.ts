import { config } from "../../config";
import { Logger, LoggerContext } from "../types";
import { createLogStore } from "../logStore";
import { isPlainObject, safeJson, formatTime } from "../formatUtils";
import { Colors } from "./colors";

export class NodeLogger implements Logger {
    public level?: string;
    private context: LoggerContext;
    private logStore: ReturnType<typeof createLogStore>;
    private excludedTags: Set<string>;
    private enableMemoryStorage: boolean;

    constructor(
        context: LoggerContext = {},
        level?: string,
        enableMemoryStorage: boolean = false,
        excludedTags: Set<string> = new Set()
    ) {
        this.context = context;
        this.level = level;
        this.enableMemoryStorage = enableMemoryStorage;
        this.excludedTags = excludedTags;
        const maxSize = (config.CRASH_LOG_MAX_SIZE_MB || 10) * 1024 * 1024;
        this.logStore = createLogStore(maxSize, enableMemoryStorage);
    }

    public child(context: LoggerContext): Logger {
        return new NodeLogger(
            { ...this.context, ...(context || {}) },
            this.level,
            this.enableMemoryStorage,
            this.excludedTags
        );
    }

    private shouldExcludeLog(context: LoggerContext): boolean {
        const tagsToCheck: string[] = [];

        if (typeof context.component === "string") {
            tagsToCheck.push(context.component);
        }

        if (Array.isArray((context as any).tags)) {
            tagsToCheck.push(...(context as any).tags);
        }

        return tagsToCheck.some((tag) =>
            this.excludedTags.has(tag.toLowerCase())
        );
    }

    private storeLog(level: string, message: any, meta?: any): void {
        this.logStore.store(level, message, this.context, meta);
    }

    public getAllLogs(): any[] {
        return this.logStore.getAllLogs();
    }

    public clearLogs(): void {
        this.logStore.clearLogs();
    }

    private formatMessage(level: string, message: any, meta?: any): string {
        const extra = isPlainObject(meta) ? meta : undefined;
        const merged = extra
            ? { ...this.context, ...extra }
            : { ...this.context };

        // Check if this log should be excluded
        if (this.shouldExcludeLog(merged)) {
            return "";
        }

        const time = formatTime();
        const levelUpper = level.toUpperCase();

        let prefix = "";

        // Timestamp
        prefix += `${Colors.TIMESTAMP}[${time}]${Colors.RESET}`;

        // Log level with color
        prefix += `${Colors.LEVEL[level as keyof typeof Colors.LEVEL] || Colors.LEVEL.debug}[${levelUpper}]${Colors.RESET}`;

        // Peer context
        const peerId = merged.peerId;
        const peerAddress = merged.peerAddress;
        if (peerId == null) {
            prefix += `${Colors.RESET}`;
        } else {
            const peerColor = Colors.PEER[Number(peerId) % Colors.PEER.length];
            prefix += `${peerColor}[Peer ${peerId}]${Colors.RESET}`;
            if (peerAddress && typeof peerAddress === "string") {
                prefix += `${peerColor}[${peerAddress.slice(0, 8)}...]${Colors.RESET}`;
            }
        }

        // Component
        if (merged.component)
            prefix += `${Colors.COMPONENT}[${merged.component}]${Colors.RESET}`;

        // Meta (exclude the common context keys)
        const metaForInline: Record<string, any> = { ...merged };
        delete metaForInline.peerId;
        delete metaForInline.peerAddress;
        delete metaForInline.component;

        const hasMeta = Object.keys(metaForInline).length > 0;
        const metaStr = hasMeta ? ` ${safeJson(metaForInline)}` : "";

        return `${prefix} ${message}${metaStr}`;
    }

    public debug(message: any, meta?: any, ...args: any[]): void {
        this.storeLog("debug", message, meta);
        const formatted = this.formatMessage("debug", message, meta);
        if (formatted) {
            // eslint-disable-next-line no-console
            console.debug(formatted, ...args);
        }
    }

    public info(message: any, meta?: any, ...args: any[]): void {
        this.storeLog("info", message, meta);
        const formatted = this.formatMessage("info", message, meta);
        if (formatted) {
            // eslint-disable-next-line no-console
            console.info(formatted, ...args);
        }
    }

    public warn(message: any, meta?: any, ...args: any[]): void {
        this.storeLog("warn", message, meta);
        const formatted = this.formatMessage("warn", message, meta);
        if (formatted) {
            // eslint-disable-next-line no-console
            console.warn(formatted, ...args);
        }
    }

    public error(message: any, meta?: any, ...args: any[]): void {
        this.storeLog("error", message, meta);
        const formatted = this.formatMessage("error", message, meta);
        if (formatted) {
            // eslint-disable-next-line no-console
            console.error(formatted, ...args);
        }
    }

    public verbose(message: any, meta?: any, ...args: any[]): void {
        this.storeLog("verbose", message, meta);
        const formatted = this.formatMessage("verbose", message, meta);
        if (formatted) {
            // eslint-disable-next-line no-console
            console.debug(formatted, ...args);
        }
    }
}
