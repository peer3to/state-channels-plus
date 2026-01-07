import type winston from "winston";
import { config } from "./config";
export interface LoggerContext {
    peerId?: number;
    // Can be an EVM AddressLike or any identifier; keep flexible.
    peerAddress?: any;
    component?: string;
    [key: string]: any; // Allow additional metadata properties
}

const Colors = {
    // Peer colors for rotating assignment
    PEER: [
        "\x1b[36m", // Cyan
        "\x1b[33m", // Yellow
        "\x1b[35m", // Magenta
        "\x1b[32m", // Green
        "\x1b[34m", // Blue
        "\x1b[31m", // Red
        "\x1b[96m", // Bright Cyan
        "\x1b[95m" // Bright Magenta
    ] as const,

    // Log level colors
    LEVEL: {
        error: "\x1b[31m", // Red
        warn: "\x1b[38;5;202m", // Bright Orange-Red
        info: "\x1b[92m", // Bright Green
        debug: "\x1b[38;5;208m", // Orange
        verbose: "\x1b[95m" // Bright Magenta
    },

    // UI element colors
    RESET: "\x1b[0m",
    SYSTEM: "\x1b[90m", // Gray for system/harness logs
    COMPONENT: "\x1b[2m", // Dim for component names
    TIMESTAMP: "\x1b[90m" // Gray for timestamps
} as const;

export type Logger = {
    level?: string;
    debug: (message: any, meta?: any, ...args: any[]) => void;
    info: (message: any, meta?: any, ...args: any[]) => void;
    warn: (message: any, meta?: any, ...args: any[]) => void;
    error: (message: any, meta?: any, ...args: any[]) => void;
    verbose: (message: any, meta?: any, ...args: any[]) => void;
    child: (context: LoggerContext) => Logger;
    clear?: () => void;
    close?: () => void;
};

function isNodeRuntime(): boolean {
    return (
        typeof process !== "undefined" &&
        !!(process as any).versions?.node &&
        typeof (process as any).argv !== "undefined"
    );
}

class BrowserLogger implements Logger {
    public level?: string;
    private context: LoggerContext;

    constructor(context: LoggerContext = {}, level?: string) {
        this.context = context;
        this.level = level;
    }

    public child(context: LoggerContext): Logger {
        return new BrowserLogger(
            { ...this.context, ...(context || {}) },
            this.level
        );
    }

    private isPlainObject(value: unknown): value is Record<string, any> {
        if (!value || typeof value !== "object") return false;
        if (Array.isArray(value)) return false;
        const proto = Object.getPrototypeOf(value);
        return proto === Object.prototype || proto === null;
    }

    private formatTime(): string {
        return new Date().toLocaleTimeString("en-US", {
            hour12: false,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        });
    }

    private levelCss(level: string): string {
        // Browser consoles don't interpret ANSI escapes; use CSS instead.
        switch (level) {
            case "error":
                return "color: #dc2626; font-weight: 700";
            case "warn":
                return "color: #f97316; font-weight: 700";
            case "info":
                return "color: #22c55e; font-weight: 700";
            case "debug":
                return "color: #f59e0b; font-weight: 700";
            case "verbose":
                return "color: #a855f7; font-weight: 700";
            default:
                return "color: #f59e0b; font-weight: 700";
        }
    }

    private peerCss(peerId: number): string {
        // Keep a rotating palette similar to the node logger.
        const palette = [
            "#22d3ee", // cyan
            "#fbbf24", // yellow
            "#e879f9", // magenta
            "#4ade80", // green
            "#60a5fa", // blue
            "#f87171", // red
            "#67e8f9", // bright cyan
            "#f0abfc" // bright magenta
        ];
        return `color: ${palette[Math.abs(peerId) % palette.length]}; font-weight: 600`;
    }

    private peerCssFromAddress(peerAddress: string): string {
        // Deterministic fallback when peerId is not available.
        // (Browser consoles don't support ANSI; we use CSS colors via %c.)
        const palette = [
            "#22d3ee", // cyan
            "#fbbf24", // yellow
            "#e879f9", // magenta
            "#4ade80", // green
            "#60a5fa", // blue
            "#f87171", // red
            "#67e8f9", // bright cyan
            "#f0abfc" // bright magenta
        ];

        let hash = 0;
        for (let i = 0; i < peerAddress.length; i++) {
            hash = (hash * 31 + peerAddress.charCodeAt(i)) | 0;
        }

        const idx = Math.abs(hash) % palette.length;
        return `color: ${palette[idx]}; font-weight: 600`;
    }

    private safeJson(value: any): string {
        return JSON.stringify(value, (_key, v) =>
            typeof v === "bigint" ? v.toString() : v
        );
    }

    private fmt(level: string, message: any, meta?: any): any[] {
        const extra = this.isPlainObject(meta) ? meta : undefined;
        const merged = extra
            ? { ...this.context, ...extra }
            : { ...this.context };

        const time = this.formatTime();
        const levelUpper = level.toUpperCase();

        const parts: string[] = [];
        const styles: string[] = [];
        const push = (text: string, style: string) => {
            parts.push(`%c${text}`);
            styles.push(style);
        };

        // Timestamp
        push(`[${time}]`, "color: #9ca3af");

        // Level
        push(`[${levelUpper}]`, this.levelCss(level));

        // Peer
        const peerId = merged.peerId;
        const peerAddress = merged.peerAddress;
        if (typeof peerAddress === "string" && peerAddress.length > 0) {
            const peerStyle =
                peerId != null
                    ? this.peerCss(Number(peerId))
                    : this.peerCssFromAddress(peerAddress);

            if (peerId != null) {
                push(`[Peer ${peerId}]`, peerStyle);
            }
            push(`[${peerAddress.slice(0, 8)}...]`, peerStyle);
        }

        // Component
        if (merged.component) {
            push(
                `[${String(merged.component)}]`,
                "color: #9ca3af; opacity: 0.85"
            );
        }

        // Meta (like node formatter: exclude the common context keys)
        const metaForInline: Record<string, any> = { ...merged };
        delete metaForInline.peerId;
        delete metaForInline.peerAddress;
        delete metaForInline.component;

        const hasMeta = Object.keys(metaForInline).length > 0;
        const metaStr = hasMeta ? ` ${this.safeJson(metaForInline)}` : "";

        // Reset style after prefix so message is default console color.
        parts.push(`%c`);
        styles.push("");

        const prefix = `${parts.join("")}${metaStr}`;
        return extra
            ? [prefix, ...styles, message, extra]
            : [prefix, ...styles, message];
    }

    public debug(message: any, meta?: any, ...args: any[]): void {
        // eslint-disable-next-line no-console
        console.debug(...this.fmt("debug", message, meta), ...args);
    }
    public info(message: any, meta?: any, ...args: any[]): void {
        // eslint-disable-next-line no-console
        console.info(...this.fmt("info", message, meta), ...args);
    }
    public warn(message: any, meta?: any, ...args: any[]): void {
        // eslint-disable-next-line no-console
        console.warn(...this.fmt("warn", message, meta), ...args);
    }
    public error(message: any, meta?: any, ...args: any[]): void {
        // eslint-disable-next-line no-console
        console.error(...this.fmt("error", message, meta), ...args);
    }
    public verbose(message: any, meta?: any, ...args: any[]): void {
        // eslint-disable-next-line no-console
        console.debug(...this.fmt("verbose", message, meta), ...args);
    }
}

const peerColorFormat = (winstonImpl: typeof import("winston")) =>
    winstonImpl.format.printf(
        ({
            timestamp,
            level,
            message,
            peerId,
            peerAddress,
            component,
            ...meta
        }) => {
            let prefix = "";

            // Timestamp
            if (timestamp) {
                const timeValue =
                    typeof timestamp === "bigint"
                        ? Number(timestamp)
                        : (timestamp as string | number | Date);
                const time = new Date(timeValue).toLocaleTimeString("en-US", {
                    hour12: false,
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit"
                });
                prefix += `${Colors.TIMESTAMP}[${time}]${Colors.RESET}`;
            }

            // Log level with color
            prefix += `${Colors.LEVEL[level as keyof typeof Colors.LEVEL] || Colors.LEVEL.debug}[${level.toUpperCase()}]${Colors.RESET}`;

            // Peer context
            if (peerId == null) {
                prefix += `${Colors.RESET}`;
            } else {
                const peerColor =
                    Colors.PEER[Number(peerId) % Colors.PEER.length];
                prefix += `${peerColor}[Peer ${peerId}]${Colors.RESET}`;
                if (peerAddress && typeof peerAddress === "string") {
                    prefix += `${peerColor}[${peerAddress.slice(0, 8)}...]${Colors.RESET}`;
                }
            }

            // Component
            if (component)
                prefix += `${Colors.COMPONENT}[${component}]${Colors.RESET}`;

            // Metadata - handle BigInt values
            const metaStr =
                Object.keys(meta).length > 0
                    ? ` ${JSON.stringify(meta, (key, value) => {
                          if (typeof value === "bigint") {
                              return value.toString();
                          }
                          return value;
                      })}`
                    : "";
            return `${prefix} ${message}${metaStr}`;
        }
    );

// Global singleton Winston logger to prevent multiple process event listeners
let globalLogger: Logger | null = null;

function getGlobalLogger(): Logger {
    if (!globalLogger) {
        if (!isNodeRuntime()) {
            globalLogger = new BrowserLogger({}, config.LOG_LEVEL);
            return globalLogger;
        }

        // Lazy-load winston only in Node runtimes.

        const winstonImpl = require("winston") as typeof import("winston");

        // Define custom log levels with numerical priorities
        const customLevels = {
            levels: {
                error: 0,
                warn: 1,
                info: 2,
                debug: 3,
                verbose: 4
            }
        };

        const logLevel = PeerLogger.parseLogLevelFromArgs();
        const excludedTags = PeerLogger.parseExcludedTagsFromArgs();

        const tagFilter = winstonImpl.format((info) => {
            const tagsToCheck: string[] = [];

            if (typeof info.component === "string") {
                tagsToCheck.push(info.component);
            }

            if (Array.isArray((info as any).tags)) {
                tagsToCheck.push(...(info as any).tags);
            }

            const shouldExclude = tagsToCheck.some((tag) =>
                excludedTags.has(tag.toLowerCase())
            );

            return shouldExclude ? false : info;
        });

        // Create the single global logger with exception/rejection handling
        const transports: winston.transport[] = [
            new winstonImpl.transports.Console({
                handleExceptions: true,
                handleRejections: true
            })
        ];

        globalLogger = winstonImpl.createLogger({
            levels: customLevels.levels,
            level: logLevel,
            format: winstonImpl.format.combine(
                tagFilter(),
                winstonImpl.format.timestamp(),
                winstonImpl.format.errors({ stack: true }),
                peerColorFormat(winstonImpl)
            ),
            transports,
            exitOnError: false
        });
    }
    return globalLogger;
}

class PeerLogger {
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
        const validLevels = ["verbose", "debug", "info", "warn", "error"];
        let logLevel = "info";

        if (
            config.LOG_LEVEL &&
            validLevels.includes(config.LOG_LEVEL.toLowerCase())
        ) {
            logLevel = config.LOG_LEVEL.toLowerCase();
        }

        const flags = ["--verbose", "--debug", "--info", "--warn", "--error"];
        for (const flag of flags) {
            if (args.includes(flag)) {
                logLevel = flag.substring(2);
                break;
            }
        }

        return logLevel;
    }

    public static parseExcludedTagsFromArgs(
        args: string[] = isNodeRuntime() ? (process as any).argv : []
    ): Set<string> {
        const excludedTags: Set<string> = new Set();
        const normalize = (tag: string) => tag.trim().toLowerCase();

        const addTags = (value?: string) => {
            if (!value) return;
            value
                .split(/[,\s]+/)
                .map(normalize)
                .filter(Boolean)
                .forEach((tag) => excludedTags.add(tag));
        };

        addTags(config.LOG_EXCLUDE_TAGS);
        addTags(config.EXCLUDE_LOG_TAGS);

        const flagIndex = args.findIndex((arg) => arg === "--exclude-tags");
        if (flagIndex !== -1) {
            addTags(args[flagIndex + 1]);
        }

        const eqFlag = args.find((arg) => arg.startsWith("--exclude-tags="));
        if (eqFlag) {
            addTags(eqFlag.split("=", 2)[1]);
        }

        return excludedTags;
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
