import {
    LogEntry,
    Logger,
    ExclusiveLoggerContext,
    LogLevel,
    SharedLoggerContext
} from "../Logger";
import { NodeLogUploader } from "../LogUploader";
import type { LogUploaderOptions } from "../LogUploader";
import type { LogStore } from "../logStore";
import { Colors } from "./colors";
import { config, isNodeRuntime } from "../../config";
import { formatTimeFromSeconds } from "../formatUtils";

export class NodeLogger extends Logger {
    private excludedTags: Set<string>;

    constructor(
        context: ExclusiveLoggerContext = {},
        sharedContext: SharedLoggerContext,
        level: LogLevel | undefined,
        logStore: LogStore,
        logUploaderOptions?: LogUploaderOptions,
        excludedTags: Set<string> = new Set()
    ) {
        const logUploader =
            logUploaderOptions?.logUploader ||
            (logUploaderOptions?.logUploaderConfig
                ? new NodeLogUploader(
                      logStore,
                      logUploaderOptions.logUploaderConfig,
                      context,
                      sharedContext,
                      logUploaderOptions.attachErrorListener ?? true
                  )
                : undefined);

        super(context, sharedContext, level, logStore, logUploader);
        this.excludedTags = excludedTags;
    }

    protected createChild(context: ExclusiveLoggerContext): Logger {
        return new NodeLogger(
            context,
            this.sharedContext,
            this.level,
            this.logStore,
            { logUploader: this.logUploader },
            this.excludedTags
        );
    }

    private shouldExcludeLog(context: ExclusiveLoggerContext): boolean {
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

    private formatMessage(logEntry: LogEntry): string {
        // Check if this log should be excluded
        if (this.shouldExcludeLog(logEntry.context)) {
            return "";
        }

        const time = formatTimeFromSeconds(logEntry.time);
        const level = logEntry.level;
        const levelUpper = level.toUpperCase();

        let prefix = "";

        // Timestamp
        prefix += `${Colors.TIMESTAMP}[${time}]${Colors.RESET}`;

        // Log level with color
        prefix += `${Colors.LEVEL[level as keyof typeof Colors.LEVEL] || Colors.LEVEL.debug}[${levelUpper}]${Colors.RESET}`;

        // Peer context
        const peerId = logEntry.sharedContext.peerId;
        const peerAddress = logEntry.sharedContext.peerAddress;
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
        if (logEntry.context.component)
            prefix += `${Colors.COMPONENT}[${logEntry.context.component}]${Colors.RESET}`;

        return `${prefix} ${logEntry.message}`;
    }
    private formatMeta(logEntry: LogEntry): any {
        const hasMeta = logEntry.meta.length > 0;
        const inspectFn = getInspect();
        const metaStr = hasMeta
            ? inspectFn
                ? inspectFn(logEntry.meta, {
                      depth: null,
                      colors: true,
                      maxArrayLength: null,
                      breakLength: 80
                  })
                : logEntry.meta
            : "";
        return metaStr;
    }
    protected write(logEntry: LogEntry): void {
        const { level } = logEntry;
        const method = level === "verbose" ? "debug" : level;
        const formattedMessage = this.formatMessage(logEntry);
        const formattedMeta = this.formatMeta(logEntry);
        if (
            console.groupCollapsed &&
            level !== "debug" &&
            level !== "verbose" // don't use groups for debug/verbose since group labels are always INFO...
        ) {
            // eslint-disable-next-line no-console
            console.groupCollapsed(formattedMessage);
            // eslint-disable-next-line no-console
            console[method](formattedMeta);
            // eslint-disable-next-line no-console
            console[method](logEntry.stack);
            // eslint-disable-next-line no-console
            console.groupEnd();
            return;
        }

        // Fallback when groups are not supported
        // eslint-disable-next-line no-console
        (console as any)[method](
            formattedMessage,
            formattedMeta,
            logEntry.stack
        );
    }

    public group(label?: string): void {
        if (label) {
            console.group(label);
        } else {
            console.group();
        }
    }

    public groupEnd(): void {
        console.groupEnd();
    }

    public static parseLogLevelFromArgs(
        args: string[] = isNodeRuntime() ? (process as any).argv : []
    ): LogLevel {
        const validLevels: LogLevel[] = [
            "verbose",
            "debug",
            "info",
            "warn",
            "error"
        ];
        let logLevel: LogLevel = "info";

        if (
            config.LOG_LEVEL &&
            validLevels.includes(config.LOG_LEVEL.toLowerCase() as LogLevel)
        ) {
            logLevel = config.LOG_LEVEL.toLowerCase() as LogLevel;
        }

        const flags = ["--verbose", "--debug", "--info", "--warn", "--error"];
        for (const flag of flags) {
            if (args.includes(flag)) {
                logLevel = flag.substring(2) as LogLevel;
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

// ******* Bundler safe sync dynamic import of util.inspect that runs only in nodejs ********

let cachedInspect: ((value: any, options?: any) => string) | undefined;

function getInspect(): ((value: any, options?: any) => string) | undefined {
    if (cachedInspect) return cachedInspect;
    if (!isNodeRuntime()) return undefined;
    try {
        // Use eval to avoid bundlers injecting require in browser builds.
        // eslint-disable-next-line @typescript-eslint/no-implied-eval
        const req =
            typeof require === "function" ? require : (0, eval)("require");
        const util = req("util");
        cachedInspect = util.inspect;
        return cachedInspect;
    } catch {
        return undefined;
    }
}
