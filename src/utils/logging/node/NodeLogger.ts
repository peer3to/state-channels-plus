import {
    LogEntry,
    Logger,
    ExclusiveLoggerContext,
    LogLevel,
    SharedLoggerContext,
    LoggerPerformanceMonitorOptions
} from "../Logger";
import { NodeLogUploader } from "./NodeLogUploader";
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
        excludedTags: Set<string> = new Set(),
        private readonly skipWriting: boolean = false
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
        logUploader?.setLogger(this);
    }

    protected createChild(context: ExclusiveLoggerContext): Logger {
        return new NodeLogger(
            context,
            this.sharedContext,
            this.level,
            this.logStore,
            { logUploader: this.logUploader },
            this.excludedTags,
            this.skipWriting
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

    protected write(logEntry: LogEntry): void {
        if (this.skipWriting) {
            return;
        }

        const { level } = logEntry;
        const formattedMessage = this.formatMessage(logEntry);
        const formattedMeta = logEntry.meta;
        if (
            console.groupCollapsed &&
            level !== "debug" &&
            level !== "verbose" // don't use groups for debug/verbose since group labels are always INFO...
        ) {
            // eslint-disable-next-line no-console
            console.groupCollapsed(formattedMessage);
            // eslint-disable-next-line no-console
            console.log(formattedMeta);
            // eslint-disable-next-line no-console
            console.log(logEntry.stack);
            // eslint-disable-next-line no-console
            console.groupEnd();
            return;
        }

        // Fallback when groups are not supported
        // eslint-disable-next-line no-console
        console.log(formattedMessage, formattedMeta, logEntry.stack);
    }

    protected createPerformanceMonitor(
        options: LoggerPerformanceMonitorOptions
    ): () => void {
        let stopped = false;
        let stopMonitor: (() => void) | undefined;

        const getDelayErrorThresholdMs = () => {
            if (options.delayErrorThresholdMs !== undefined) {
                return options.delayErrorThresholdMs;
            }
            return (
                (config.EVENT_LOOP_DELAY_ERROR_THRESHOLD_SECONDS || 0) * 1000
            );
        };

        void import("node:perf_hooks")
            .then(({ monitorEventLoopDelay, performance }) => {
                if (stopped) return;

                const intervalMs = options.intervalMs ?? 1000;
                const sampleIntervalMs = options.sampleIntervalMs ?? 10;
                const delayWarnThresholdMs =
                    options.delayWarnThresholdMs ?? 200;
                const utilizationWarnThreshold =
                    options.utilizationWarnThreshold ?? 0.8;
                const h = monitorEventLoopDelay({
                    resolution: sampleIntervalMs
                });
                h.enable();
                let last = performance.eventLoopUtilization();

                // Report the running event-loop-delay peak for this thread to the
                // parallel test runner (a ##E2E_TIMING## marker on stdout, which
                // it prints per test). Emit on each increase because SDK/VM worker
                // threads are force-terminated. Enabled whenever the event-loop
                // monitor threshold is configured (tests only), so production is
                // unaffected.
                const emitTiming =
                    config.EVENT_LOOP_DELAY_ERROR_THRESHOLD_SECONDS > 0;
                const elThread = options.threadLabel ?? "main";
                let peakMs = 0;

                const toMs = (nanoseconds: number) => {
                    const ms = nanoseconds / 1e6;
                    return Number.isFinite(ms) ? ms : 0;
                };

                const timer = setInterval(() => {
                    if (stopped) return;
                    const elu = performance.eventLoopUtilization(last);
                    last = performance.eventLoopUtilization();
                    const dMean = toMs(h.mean);
                    const d50 = toMs(h.percentile(50));
                    const d90 = toMs(h.percentile(90));
                    const d99 = toMs(h.percentile(99));
                    const dMax = toMs(h.max);

                    if (emitTiming && dMax > peakMs) {
                        peakMs = dMax;
                        // Worker process.stdout is forwarded to the parent's,
                        // which the runner captures for this test.
                        process.stdout.write(
                            `##E2E_TIMING## ${JSON.stringify({
                                maxEventLoopDelayMs: Math.round(peakMs),
                                elThread
                            })}\n`
                        );
                    }
                    const utilization = elu.utilization;
                    const shouldWarn =
                        utilization > utilizationWarnThreshold ||
                        dMean > delayWarnThresholdMs ||
                        d50 > delayWarnThresholdMs ||
                        d90 > delayWarnThresholdMs ||
                        d99 > delayWarnThresholdMs ||
                        dMax > delayWarnThresholdMs;
                    const logFn = shouldWarn
                        ? this.warn.bind(this)
                        : this.verbose.bind(this);
                    logFn(
                        `Event Loop mean delay: ${dMean}ms, max: ${dMax}ms, utilization: ${utilization}`,
                        {
                            runtime: "node",
                            dMean,
                            d50,
                            d90,
                            d99,
                            dMax,
                            utilization
                        }
                    );
                    const delayErrorThresholdMs = getDelayErrorThresholdMs();
                    if (
                        delayErrorThresholdMs > 0 &&
                        dMax > delayErrorThresholdMs
                    ) {
                        const details = {
                            runtime: "node",
                            dMean,
                            d50,
                            d90,
                            d99,
                            dMax,
                            utilization,
                            delayErrorThresholdMs
                        };
                        stopped = true;
                        stopMonitor?.();
                        const error = new Error(
                            `Event loop delay ${dMax}ms exceeded configured threshold ${delayErrorThresholdMs}ms`
                        );
                        (error as any).eventLoopDelay = details;
                        throw error;
                    }
                    h.reset();
                }, intervalMs);

                stopMonitor = () => {
                    clearInterval(timer);
                    h.disable();
                };
            })
            .catch((error) => {
                if (stopped) return;
                this.warn("Event loop performance monitoring unavailable", {
                    error:
                        error instanceof Error ? error.message : String(error)
                });
            });

        return () => {
            stopped = true;
            stopMonitor?.();
        };
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
