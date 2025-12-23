import winston from "winston";
import Transport from "winston-transport";

export enum LoggingMode {
    DEVELOPMENT = "development", // Console only
    TESTNET = "testnet", // Console + remote (send errors to server)
    MAINNET = "mainnet" // Disabled (no logging)
}

/**
 * Remote transport configuration
 */
export interface RemoteConfig {
    endpoint: string;
    headers?: Record<string, string>; // Custom headers
}

export interface LoggingConfig {
    enabled: boolean;
    level: string;
    mode: LoggingMode;

    // Transport flags
    console: boolean;
    remote?: RemoteConfig;

    // Filtering
    excludeTags?: string[];
}

export const defaultConfigs: Record<LoggingMode, Partial<LoggingConfig>> = {
    [LoggingMode.DEVELOPMENT]: {
        enabled: true,
        level: "debug",
        console: true
    },

    [LoggingMode.TESTNET]: {
        enabled: true,
        level: "info",
        console: true,
        remote: {
            endpoint: "https://api.example.com/logs",
            headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer <token>"
            }
        }
    },
    [LoggingMode.MAINNET]: {
        enabled: false,
        level: "error",
        console: false
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// CONSOLE FORMATTER
// ─────────────────────────────────────────────────────────────────────────────

const Colors = {
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
    LEVEL: {
        error: "\x1b[31m",
        warn: "\x1b[38;5;202m",
        info: "\x1b[92m",
        debug: "\x1b[38;5;208m",
        verbose: "\x1b[95m"
    },
    RESET: "\x1b[0m",
    COMPONENT: "\x1b[2m",
    TIMESTAMP: "\x1b[90m"
} as const;

function hashStringToColor(str: string): string {
    const traceColors = [
        "\x1b[38;5;196m",
        "\x1b[38;5;46m",
        "\x1b[38;5;226m",
        "\x1b[38;5;21m",
        "\x1b[38;5;208m",
        "\x1b[38;5;51m",
        "\x1b[38;5;201m",
        "\x1b[38;5;15m",
        "\x1b[38;5;244m",
        "\x1b[38;5;93m"
    ];
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = (hash << 5) - hash + str.charCodeAt(i);
        hash = hash & hash;
    }
    return traceColors[Math.abs(hash) % traceColors.length];
}

/**
 * Console formatter - colorful, human-readable output
 */
export const consoleFormat = () =>
    winston.format.printf(
        ({
            timestamp,
            level,
            message,
            component,
            traceId,
            peerId,
            peerAddress,
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

            // Peer context (from log metadata, not config)
            if (peerId != null) {
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

            // TraceId
            if (traceId) {
                const traceColor = hashStringToColor(String(traceId));
                prefix += `${traceColor}[${String(traceId).slice(0, 8)}]${Colors.RESET}`;
            }

            // Metadata (excluding already-displayed fields)
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

/**
 * Minimal remote transport example - sends plain JSON to server

 


 */
class RemoteTransport extends Transport {
    private endpoint: string;
    private headers: Record<string, string>;

    constructor(opts: RemoteConfig & Transport.TransportStreamOptions) {
        super(opts);
        this.endpoint = opts.endpoint;
        this.headers = opts.headers ?? {};
    }

    log(info: any, callback: () => void): void {
        setImmediate(() => this.emit("logged", info));

        // Send immediately (in production, you'd batch these)
        this.sendLog(info).catch((err) => {
            // Silently fail - don't break app if logging fails
            console.warn("[RemoteTransport] Failed:", err.message);
        });

        callback();
    }

    private async sendLog(info: any): Promise<void> {
        const payload = {
            timestamp: info.timestamp || new Date().toISOString(),
            level: info.level,
            message: info.message,
            component: info.component,
            ...info
        };

        await fetch(this.endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...this.headers },
            body: JSON.stringify(payload)
        });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN LOGGER CREATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create Winston logger with configured transports
 */
export function createWinstonLogger(config: LoggingConfig): winston.Logger {
    // If logging disabled (mainnet), return a silent logger
    if (!config.enabled) {
        return winston.createLogger({
            silent: true,
            transports: []
        });
    }

    const transports: winston.transport[] = [];

    // Tag filter
    const tagFilter = winston.format((info) => {
        // Build list of tags to check
        const tagsToCheck: string[] = [];
        if (typeof info.component === "string") {
            tagsToCheck.push(info.component);
        }
        if (Array.isArray((info as any).tags)) {
            tagsToCheck.push(...(info as any).tags);
        }

        // Check excludeTags
        if (config.excludeTags && config.excludeTags.length > 0) {
            const shouldExclude = tagsToCheck.some((tag) =>
                config.excludeTags!.some(
                    (excludeTag) =>
                        tag.toLowerCase() === excludeTag.toLowerCase()
                )
            );
            if (shouldExclude) {
                return false;
            }
        }

        return info;
    });

    if (config.console) {
        transports.push(
            new winston.transports.Console({
                format: winston.format.combine(
                    tagFilter(),
                    winston.format.timestamp(),
                    consoleFormat()
                ),
                handleExceptions: true,
                handleRejections: true
            })
        );
    }

    // ─── Remote Transport (plain JSON) ───
    if (config.remote) {
        transports.push(
            new RemoteTransport({
                ...config.remote,
                level: config.level
            })
        );
        console.log(
            `[Logging] Remote logging enabled: ${config.remote.endpoint}`
        );
    }

    return winston.createLogger({
        level: config.level,
        levels: {
            error: 0,
            warn: 1,
            info: 2,
            debug: 3,
            verbose: 4
        },
        transports,
        exitOnError: false
    });
}

export function detectLoggingMode(): LoggingMode {
    // Browser detection
    if (typeof window !== "undefined") {
        // @ts-ignore - custom global for browser config
        const browserMode = window.__LOGGING_MODE__ || window.LOGGING_MODE;
        if (browserMode && Object.values(LoggingMode).includes(browserMode)) {
            return browserMode as LoggingMode;
        }
        // Default for browser: check if looks like production URL
        // @ts-ignore
        if (
            window.location?.hostname &&
            !window.location.hostname.includes("localhost")
        ) {
            return LoggingMode.MAINNET; // Assume production
        }
        return LoggingMode.TESTNET;
    }

    return LoggingMode.DEVELOPMENT;
}

export function parseExcludeTags(args: string[] = process.argv): string[] {
    const excludedTags: string[] = [];
    const normalize = (tag: string) => tag.trim().toLowerCase();

    const addTags = (value?: string) => {
        if (!value) return;
        value
            .split(/[,\s]+/)
            .map(normalize)
            .filter(Boolean)
            .forEach((tag) => excludedTags.push(tag));
    };

    // Check environment variables
    if (typeof process !== "undefined" && process.env) {
        addTags(process.env.LOG_EXCLUDE_TAGS);
        addTags(process.env.EXCLUDE_LOG_TAGS);
    }

    // Check command-line args
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

/**
 * Create config for a specific mode with overrides
 */
export function createLoggerConfig(
    mode: LoggingMode,
    overrides: Partial<LoggingConfig> = {}
): LoggingConfig {
    const defaults = defaultConfigs[mode];
    return {
        enabled: true,
        level: "info",
        mode,
        console: true,
        ...defaults,
        ...overrides
    };
}

/**
 * Create config automatically based on environment
 */
export function createAutoConfig(
    overrides: Partial<LoggingConfig> = {}
): LoggingConfig {
    const mode = detectLoggingMode();

    // Read LOG_LEVEL from environment
    let level = "info";
    if (
        typeof process !== "undefined" &&
        process.env &&
        process.env.LOG_LEVEL
    ) {
        const validLevels = ["verbose", "debug", "info", "warn", "error"];
        if (validLevels.includes(process.env.LOG_LEVEL.toLowerCase())) {
            level = process.env.LOG_LEVEL.toLowerCase();
        }
    }

    const excludeTags = parseExcludeTags();

    return createLoggerConfig(mode, {
        level,
        excludeTags: excludeTags.length > 0 ? excludeTags : undefined,
        ...overrides
    });
}
