import {
    LogEntry,
    Logger,
    ExclusiveLoggerContext,
    LogLevel,
    SharedLoggerContext
} from "../Logger";
import type {
    EventLoopDelayDetails,
    PerformanceMonitorInternalOptions,
    PerformanceSampleSource
} from "../performanceMonitorInternal";
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
        options: PerformanceMonitorInternalOptions
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

        const source =
            options.sampleSource ??
            this.createBrowserSampleSource(intervalMs, sampleIntervalMs);
        source.start();

        const reportTimer = setInterval(() => {
            const sample = source.sample();
            const estimatedUtilization = sample.utilization;
            const longTaskCount = sample.longTaskCount ?? 0;
            const longTaskMean = sample.longTaskMean ?? 0;
            const longTaskMax = sample.longTaskMax ?? 0;
            const shouldWarn =
                estimatedUtilization > utilizationWarnThreshold ||
                sample.dMean > delayWarnThresholdMs ||
                sample.d50 > delayWarnThresholdMs ||
                sample.d90 > delayWarnThresholdMs ||
                sample.d99 > delayWarnThresholdMs ||
                sample.dMax > delayWarnThresholdMs ||
                longTaskMax > delayWarnThresholdMs;
            const logFn = shouldWarn
                ? this.warn.bind(this)
                : this.verbose.bind(this);
            logFn(
                `Event Loop mean delay: ${sample.dMean}ms, max: ${sample.dMax}ms, estimated utilization: ${estimatedUtilization}`,
                {
                    runtime: "browser",
                    dMean: sample.dMean,
                    d50: sample.d50,
                    d90: sample.d90,
                    d99: sample.d99,
                    dMax: sample.dMax,
                    estimatedUtilization,
                    longTaskCount,
                    longTaskMean,
                    longTaskMax
                }
            );

            const delayErrorThresholdMs = getDelayErrorThresholdMs();
            const maxDelayMs = Math.max(sample.dMax, longTaskMax);
            if (
                delayErrorThresholdMs > 0 &&
                maxDelayMs > delayErrorThresholdMs
            ) {
                const error = new Error(
                    `Event loop delay ${maxDelayMs}ms exceeded configured threshold ${delayErrorThresholdMs}ms`
                );
                const details: EventLoopDelayDetails = {
                    runtime: "browser",
                    dMean: sample.dMean,
                    d50: sample.d50,
                    d90: sample.d90,
                    d99: sample.d99,
                    dMax: sample.dMax,
                    estimatedUtilization,
                    longTaskCount,
                    longTaskMean,
                    longTaskMax,
                    delayErrorThresholdMs
                };
                (
                    error as Error & { eventLoopDelay?: EventLoopDelayDetails }
                ).eventLoopDelay = details;
                clearInterval(reportTimer);
                source.stop();
                throw error;
            }

            source.reset();
        }, intervalMs);
        options.onStarted?.();

        return () => {
            clearInterval(reportTimer);
            source.stop();
        };
    }

    /**
     * The real browser sample source: timer-drift delay samples plus the
     * long-task observer, collected between reporting intervals.
     */
    private createBrowserSampleSource(
        intervalMs: number,
        sampleIntervalMs: number
    ): PerformanceSampleSource {
        let delaySamples: number[] = [];
        let longTaskDurations: number[] = [];
        let lastSampleAt = this.nowMs();
        let sampleTimer: ReturnType<typeof setInterval> | undefined;
        let observer: PerformanceObserver | undefined;

        return {
            start: () => {
                lastSampleAt = this.nowMs();
                sampleTimer = setInterval(() => {
                    const now = this.nowMs();
                    const delayMs = Math.max(
                        0,
                        now - lastSampleAt - sampleIntervalMs
                    );
                    lastSampleAt = now;
                    delaySamples.push(delayMs);
                }, sampleIntervalMs);
                observer = this.tryStartLongTaskObserver((duration) => {
                    longTaskDurations.push(duration);
                });
            },
            sample: () => {
                const stats = this.computeStats(delaySamples);
                const longTaskStats = this.computeStats(longTaskDurations);
                const blockedMs = delaySamples.reduce(
                    (sum, value) => sum + value,
                    0
                );
                return {
                    dMean: stats.dMean,
                    d50: stats.d50,
                    d90: stats.d90,
                    d99: stats.d99,
                    dMax: stats.dMax,
                    utilization: Math.min(1, blockedMs / intervalMs),
                    longTaskCount: longTaskDurations.length,
                    longTaskMean: longTaskStats.dMean,
                    longTaskMax: longTaskStats.dMax
                };
            },
            reset: () => {
                delaySamples = [];
                longTaskDurations = [];
            },
            stop: () => {
                if (sampleTimer !== undefined) clearInterval(sampleTimer);
                sampleTimer = undefined;
                observer?.disconnect();
                observer = undefined;
            }
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
