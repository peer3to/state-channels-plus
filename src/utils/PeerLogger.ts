import winston from "winston";

export interface LoggerContext {
    peerId?: number;
    peerAddress?: string;
    component?: string;
    [key: string]: any; // Allow additional metadata properties
}

// ANSI color codes organized by category
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
        warn: "\x1b[33m", // Yellow
        info: "\x1b[92m", // Bright Green
        debug: "\x1b[37m" // White
    },

    // UI element colors
    RESET: "\x1b[0m",
    SYSTEM: "\x1b[90m", // Gray for system/harness logs
    COMPONENT: "\x1b[2m", // Dim for component names
    TIMESTAMP: "\x1b[90m" // Gray for timestamps
} as const;

export type Logger = winston.Logger;

const peerColorFormat = winston.format.printf(
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
            prefix += `${Colors.SYSTEM}[SYSTEM]${Colors.RESET}`;
        } else {
            const peerColor = Colors.PEER[Number(peerId) % Colors.PEER.length];
            prefix += `${peerColor}[Peer ${peerId}]${Colors.RESET}`;
            if (peerAddress && typeof peerAddress === "string") {
                prefix += `${peerColor}[${peerAddress.slice(0, 8)}...]${Colors.RESET}`;
            }
        }

        // Component
        if (component)
            prefix += `${Colors.COMPONENT}[${component}]${Colors.RESET}`;

        // Metadata
        const metaStr =
            Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";
        return `${prefix} ${message}${metaStr}`;
    }
);

class PeerLogger {
    private static instance: PeerLogger;
    private logger: winston.Logger;

    private constructor() {
        this.logger = winston.createLogger({
            level: "debug",
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.errors({ stack: true }),
                peerColorFormat
            ),
            transports: [
                new winston.transports.Console({
                    handleExceptions: true,
                    handleRejections: true
                })
            ],
            exitOnError: false
        });
    }

    public static getInstance(): PeerLogger {
        if (!PeerLogger.instance) {
            PeerLogger.instance = new PeerLogger();
        }
        return PeerLogger.instance;
    }

    public setLogLevel(level: string): void {
        this.logger.level = level;
    }

    public cleanup(): void {
        this.logger.clear();
        this.logger.close();
    }

    public static cleanup(): void {
        if (PeerLogger.instance) {
            PeerLogger.instance.cleanup();
            PeerLogger.instance = null as any;
        }
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

    public child(context: LoggerContext): winston.Logger {
        return this.logger.child(context);
    }

    public static parseLogLevelFromArgs(args: string[] = process.argv): void {
        const validLevels = ["debug", "info", "warn", "error"];
        let logLevel = "info";

        if (
            process.env.LOG_LEVEL &&
            validLevels.includes(process.env.LOG_LEVEL.toLowerCase())
        ) {
            logLevel = process.env.LOG_LEVEL.toLowerCase();
        }

        const flags = ["--debug", "--info", "--warn", "--error"];
        for (const flag of flags) {
            if (args.includes(flag)) {
                logLevel = flag.substring(2);
                break;
            }
        }

        PeerLogger.getInstance().setLogLevel(logLevel);
    }

    public static setLogLevel(level: string): void {
        PeerLogger.getInstance().setLogLevel(level);
    }
}

// Exports
const loggerInstance = PeerLogger.getInstance();

export const logger = loggerInstance;
export const createLogger = (context: LoggerContext) =>
    loggerInstance.child(context);
export const systemLogger = loggerInstance.child({});
export const parseLogLevelFromArgs = (args?: string[]) =>
    PeerLogger.parseLogLevelFromArgs(args);
export const setLogLevel = (level: string) => PeerLogger.setLogLevel(level);
export const cleanupLogger = () => PeerLogger.cleanup();
export default PeerLogger;
