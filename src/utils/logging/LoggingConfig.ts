import winston from "winston";
import IndexDBTransport from "./transports/IndexDBTransport";
import { consoleFormat } from "./formatters/consoleFormat";
import { parseExcludeTags } from "./cli";

export enum LoggingMode {
    DEVELOPMENT = "development", // Console
    TESTNET = "testnet", // Console +  Browser's IndexedDB storage
    MAINNET = "mainnet" // None
}

/**
 * Browser's IndexedDB storage logging configuration with rotation
 */
export interface BrowserStorageConfig {
    enabled: boolean;
    maxSize?: number; // Max storage size in bytes (default: 50MB)
    maxAge?: number; // Max age in milliseconds (default: 7 days)
    dbName?: string; // IndexedDB database name (default: "peer3_logs")
}

/**
 * Crash upload configuration
 * Uses a write-only API token that only allows creating/appending files
 */
export interface CrashUploadConfig {
    enabled: boolean;
    uploadEndpoint: string; // API endpoint that handles crash log uploads
    apiToken: string; // Write-only token for crash log uploads
    prefix?: string; // Log file prefix (default: "crash-")
}

export interface LoggingConfig {
    enabled: boolean;
    level: string;
    mode: LoggingMode;

    // Transport flags
    console: boolean;
    browserStorage?: BrowserStorageConfig;

    // Crash upload (only used on uncaught exceptions)
    crashUpload?: CrashUploadConfig;

    // Filtering
    excludeTags?: string[];
}

// Crash upload configuration constants
const CRASH_UPLOAD_ENDPOINT = "https://api.example.com/crash-upload"; // TODO: Replace with actual endpoint
const CRASH_UPLOAD_API_TOKEN = "example-token-placeholder"; // TODO: Replace with actual token
const CRASH_UPLOAD_PREFIX = "crash-";

export const loggingConfigs: Record<LoggingMode, Partial<LoggingConfig>> = {
    [LoggingMode.DEVELOPMENT]: {
        enabled: true,
        level: "debug",
        console: true,
        browserStorage: {
            enabled: false
        }
    },

    [LoggingMode.TESTNET]: {
        enabled: true,
        level: "verbose",
        console: true,
        browserStorage: {
            enabled: true,
            maxSize: 50 * 1024 * 1024, // 50MB
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days in milliseconds
        }
    },
    [LoggingMode.MAINNET]: {
        enabled: false
    }
};

export const isBrowser = () => typeof window !== "undefined";

// ─────────────────────────────────────────────────────────────────────────────
// MAIN LOGGER CREATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create Winston logger with configured transports
 */
export function createWinstonLogger(config: LoggingConfig): winston.Logger {
    // If logging disabled, return a silent logger
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
                handleExceptions: false,
                handleRejections: false
            })
        );
    }

    // IndexedDB Transport
    if (config.browserStorage?.enabled && typeof indexedDB !== "undefined") {
        const indexDBTransport = new IndexDBTransport({
            dbName: config.browserStorage.dbName,
            maxSize: config.browserStorage.maxSize,
            maxAge: config.browserStorage.maxAge,
            format: winston.format.combine(
                tagFilter(),
                winston.format.timestamp(),
                winston.format.json()
            ),
            level: config.level,
            handleExceptions: false,
            handleRejections: false
        });

        transports.push(indexDBTransport);
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
    if (isBrowser()) {
        // @ts-ignore - custom global for browser config
        const browserMode = window.__LOGGING_MODE__ || window.LOGGING_MODE;
        if (browserMode && Object.values(LoggingMode).includes(browserMode)) {
            return browserMode as LoggingMode;
        }
        // Default for browser: check if looks like production URL
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

/**
 * Parse crash upload configuration
 * Enabled flag is controlled by window toggle (client-side only)
 */
export function parseCrashUploadConfig(): CrashUploadConfig | undefined {
    // Check window toggle flag (client-side only)
    let enabled = false;
    if (isBrowser()) {
        enabled =
            (window as any).__ENABLE_CRASH_UPLOAD__ === true ||
            (window as any).ENABLE_CRASH_UPLOAD === true;
    }

    // Only return config if enabled
    if (enabled) {
        return {
            enabled: true,
            uploadEndpoint: CRASH_UPLOAD_ENDPOINT,
            apiToken: CRASH_UPLOAD_API_TOKEN,
            prefix: CRASH_UPLOAD_PREFIX
        };
    }

    return undefined;
}

export function createLoggerConfig(
    mode: LoggingMode,
    overrides: Partial<LoggingConfig> = {}
): LoggingConfig {
    const defaults = loggingConfigs[mode];
    return {
        enabled: true,
        level: "info",
        mode,
        console: true,
        ...defaults,
        ...overrides
    };
}

export function createAutoConfig(): LoggingConfig {
    const mode = detectLoggingMode();

    const excludeTags = parseExcludeTags();
    const crashUpload = parseCrashUploadConfig();

    return createLoggerConfig(mode, {
        excludeTags: excludeTags.length > 0 ? excludeTags : undefined,
        crashUpload
    });
}
