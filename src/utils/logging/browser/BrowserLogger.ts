import {
    LogEntry,
    Logger,
    ExclusiveLoggerContext,
    LogLevel,
    SharedLoggerContext,
    LoggerPerformanceMonitorOptions
} from "../Logger";
import { BrowserLogUploader } from "./BrowserLogUploader";
import type { LogUploaderOptions } from "../LogUploader";
import type { LogStore } from "../logStore";
import { BROWSER_PEER_COLORS, BROWSER_LEVEL_CSS } from "./colors";
import { formatTimeFromSeconds } from "../formatUtils";
import { config } from "../../config";

export class BrowserLogger extends Logger {
    constructor(
        context: ExclusiveLoggerContext = {},
        sharedContext: SharedLoggerContext,
        level: LogLevel | undefined,
        logStore: LogStore,
        logUploaderOptions?: LogUploaderOptions,
        private readonly skipWriting: boolean = false
    ) {
        const logUploader =
            logUploaderOptions?.logUploader ||
            (logUploaderOptions?.logUploaderConfig
                ? new BrowserLogUploader(
                      logStore,
                      logUploaderOptions.logUploaderConfig,
                      context,
                      sharedContext,
                      logUploaderOptions.attachErrorListener ?? true
                  )
                : undefined);

        super(context, sharedContext, level, logStore, logUploader);
        logUploader?.setLogger(this);
    }

    protected createChild(context: ExclusiveLoggerContext): Logger {
        return new BrowserLogger(
            context,
            this.sharedContext,
            this.level,
            this.logStore,
            {
                logUploader: this.logUploader
            },
            this.skipWriting
        );
    }

    private levelCss(level: LogLevel): string {
        // Browser consoles don't interpret ANSI escapes; use CSS instead.
        return BROWSER_LEVEL_CSS[level] ?? BROWSER_LEVEL_CSS.debug;
    }

    private peerCss(peerId: number): string {
        // Keep a rotating palette similar to the node logger.
        const palette = BROWSER_PEER_COLORS;
        return `color: ${palette[Math.abs(peerId) % palette.length]}; font-weight: 600`;
    }

    private peerCssFromAddress(peerAddress: string): string {
        // Deterministic fallback when peerId is not available.
        // (Browser consoles don't support ANSI; we use CSS colors via %c.)
        const palette = BROWSER_PEER_COLORS;

        let hash = 0;
        for (let i = 0; i < peerAddress.length; i++) {
            hash = (hash * 31 + peerAddress.charCodeAt(i)) | 0;
        }

        const idx = Math.abs(hash) % palette.length;
        return `color: ${palette[idx]}; font-weight: 600`;
    }

    protected write(logEntry: LogEntry) {
        if (this.skipWriting) {
            return;
        }

        const { level, meta } = logEntry;
        const method = level === "verbose" ? "debug" : level;

        if (
            console.groupCollapsed &&
            level !== "debug" &&
            level !== "verbose" // don't use groups for debug/verbose since group labels are always INFO...
        ) {
            // eslint-disable-next-line no-console
            console.groupCollapsed(...this.fmt(logEntry));
            if (meta.length > 0) {
                // eslint-disable-next-line no-console
                console[method](...meta);
            }
            // eslint-disable-next-line no-console
            console[method](logEntry.stack);
            // eslint-disable-next-line no-console
            console.groupEnd();
            return;
        }

        // Fallback when groups are not supported
        (console as any)[method](
            ...this.fmt(logEntry),
            ...meta,
            logEntry.stack
        );
    }

    protected createPerformanceMonitor(
        options: LoggerPerformanceMonitorOptions
    ): () => void {
        const intervalMs = options.intervalMs ?? 1000;
        const sampleIntervalMs = options.sampleIntervalMs ?? 50;
        const delayWarnThresholdMs = options.delayWarnThresholdMs ?? 200;
        const getDelayErrorThresholdMs = () => {
            if (options.delayErrorThresholdMs !== undefined) {
                return options.delayErrorThresholdMs;
            }
            return (
                (config.EVENT_LOOP_DELAY_ERROR_THRESHOLD_SECONDS || 0) * 1000
            );
        };
        const utilizationWarnThreshold =
            options.utilizationWarnThreshold ?? 0.8;

        let delaySamples: number[] = [];
        let longTaskDurations: number[] = [];
        let lastSampleAt = this.nowMs();

        const sampleTimer = setInterval(() => {
            const now = this.nowMs();
            const delayMs = Math.max(0, now - lastSampleAt - sampleIntervalMs);
            lastSampleAt = now;
            delaySamples.push(delayMs);
        }, sampleIntervalMs);

        const observer = this.tryStartLongTaskObserver((duration) => {
            longTaskDurations.push(duration);
        });

        const reportTimer = setInterval(() => {
            const stats = this.computeStats(delaySamples);
            const longTaskStats = this.computeStats(longTaskDurations);
            const blockedMs = delaySamples.reduce(
                (sum, value) => sum + value,
                0
            );
            const estimatedUtilization = Math.min(1, blockedMs / intervalMs);
            const longTaskCount = longTaskDurations.length;
            const shouldWarn =
                estimatedUtilization > utilizationWarnThreshold ||
                stats.dMean > delayWarnThresholdMs ||
                stats.d50 > delayWarnThresholdMs ||
                stats.d90 > delayWarnThresholdMs ||
                stats.d99 > delayWarnThresholdMs ||
                stats.dMax > delayWarnThresholdMs ||
                longTaskStats.dMax > delayWarnThresholdMs;
            const logFn = shouldWarn
                ? this.warn.bind(this)
                : this.verbose.bind(this);
            logFn(
                `Event Loop mean delay: ${stats.dMean}ms, max: ${stats.dMax}ms, estimated utilization: ${estimatedUtilization}`,
                {
                    runtime: "browser",
                    dMean: stats.dMean,
                    d50: stats.d50,
                    d90: stats.d90,
                    d99: stats.d99,
                    dMax: stats.dMax,
                    estimatedUtilization,
                    longTaskCount,
                    longTaskMean: longTaskStats.dMean,
                    longTaskMax: longTaskStats.dMax
                }
            );

            const delayErrorThresholdMs = getDelayErrorThresholdMs();
            const maxDelayMs = Math.max(stats.dMax, longTaskStats.dMax);
            if (
                delayErrorThresholdMs > 0 &&
                maxDelayMs > delayErrorThresholdMs
            ) {
                const error = new Error(
                    `Event loop delay ${maxDelayMs}ms exceeded configured threshold ${delayErrorThresholdMs}ms`
                );
                (error as any).eventLoopDelay = {
                    runtime: "browser",
                    dMean: stats.dMean,
                    d50: stats.d50,
                    d90: stats.d90,
                    d99: stats.d99,
                    dMax: stats.dMax,
                    estimatedUtilization,
                    longTaskCount,
                    longTaskMean: longTaskStats.dMean,
                    longTaskMax: longTaskStats.dMax,
                    delayErrorThresholdMs
                };
                clearInterval(sampleTimer);
                clearInterval(reportTimer);
                observer?.disconnect();
                throw error;
            }

            delaySamples = [];
            longTaskDurations = [];
        }, intervalMs);

        return () => {
            clearInterval(sampleTimer);
            clearInterval(reportTimer);
            observer?.disconnect();
        };
    }

    private nowMs(): number {
        return globalThis.performance?.now?.() ?? Date.now();
    }

    private computeStats(values: number[]) {
        if (values.length === 0) {
            return {
                dMean: 0,
                d50: 0,
                d90: 0,
                d99: 0,
                dMax: 0
            };
        }

        const sorted = [...values].sort((a, b) => a - b);
        const dMean =
            values.reduce((sum, value) => sum + value, 0) / values.length;
        return {
            dMean,
            d50: this.percentile(sorted, 50),
            d90: this.percentile(sorted, 90),
            d99: this.percentile(sorted, 99),
            dMax: sorted[sorted.length - 1]
        };
    }

    private percentile(sortedValues: number[], percentile: number): number {
        if (sortedValues.length === 0) return 0;
        const index = Math.min(
            sortedValues.length - 1,
            Math.ceil((percentile / 100) * sortedValues.length) - 1
        );
        return sortedValues[index];
    }

    private tryStartLongTaskObserver(
        onLongTask: (durationMs: number) => void
    ): PerformanceObserver | undefined {
        const Observer = globalThis.PerformanceObserver;
        const supportedEntryTypes = Observer?.supportedEntryTypes ?? [];
        if (!supportedEntryTypes.includes("longtask")) return undefined;

        try {
            const observer = new Observer((list) => {
                for (const entry of list.getEntries()) {
                    onLongTask(entry.duration);
                }
            });
            observer.observe({ entryTypes: ["longtask"] });
            return observer;
        } catch {
            return undefined;
        }
    }

    private fmt(logEntry: LogEntry): any[] {
        const levelUpper = logEntry.level.toUpperCase();
        const parts: string[] = [];
        const styles: string[] = [];
        const push = (text: string, style: string) => {
            parts.push(`%c${text}`);
            styles.push(style);
        };

        // Timestamp
        const time = formatTimeFromSeconds(logEntry.time);

        push(`[${time}]`, "color: #9ca3af");

        // Level
        push(`[${levelUpper}]`, this.levelCss(logEntry.level));

        // Peer
        const peerId = logEntry.sharedContext.peerId;
        const peerAddress = logEntry.sharedContext.peerAddress;
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
        if (logEntry.context.component) {
            push(
                `[${String(logEntry.context.component)}]`,
                "color: #9ca3af; opacity: 0.85"
            );
        }

        // Reset style after prefix so message is default console color.
        parts.push(`%c`);
        styles.push("");

        const prefix = `${parts.join("")}`;
        return [prefix, ...styles, logEntry.message];
    }

    public group(label?: string): void {
        if (label) {
            console.group(label);
        } else {
            console.group();
        }
    }
    public groupEnd(): void {
        // eslint-disable-next-line no-console
        console.groupEnd();
    }
}
