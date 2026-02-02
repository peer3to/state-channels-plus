import {
    LogEntry,
    Logger,
    ExclusiveLoggerContext,
    LogLevel,
    SharedLoggerContext
} from "../Logger";
import { BrowserLogUploader } from "../LogUploader";
import type { LogUploaderOptions } from "../LogUploader";
import type { LogStore } from "../logStore";
import { BROWSER_PEER_COLORS, BROWSER_LEVEL_CSS } from "./colors";

export class BrowserLogger extends Logger {
    constructor(
        context: ExclusiveLoggerContext = {},
        sharedContext: SharedLoggerContext,
        level: LogLevel | undefined,
        logStore: LogStore,
        logUploaderOptions?: LogUploaderOptions
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
    }

    protected createChild(context: ExclusiveLoggerContext): Logger {
        return new BrowserLogger(
            context,
            this.sharedContext,
            this.level,
            this.logStore,
            {
                logUploader: this.logUploader
            }
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
        const { level, meta } = logEntry;
        const method = level === "verbose" ? "debug" : level;

        if (
            console.groupCollapsed &&
            level !== "debug" &&
            level !== "verbose" // don't use groups for debug/verbose since group labels are always INFO...
        ) {
            // eslint-disable-next-line no-console
            console.groupCollapsed(...this.fmt(logEntry));
            // eslint-disable-next-line no-console
            console[method](meta);
            // eslint-disable-next-line no-console
            console[method](logEntry.stack);
            // eslint-disable-next-line no-console
            console.groupEnd();
            return;
        }

        // Fallback when groups are not supported
        // eslint-disable-next-line no-console
        (console as any)[method](...this.fmt(logEntry), meta, logEntry.stack);
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
        push(`[${logEntry.time}]`, "color: #9ca3af");

        // Level
        push(`[${levelUpper}]`, this.levelCss(logEntry.level));

        // Peer
        const peerId = logEntry.context.peerId;
        const peerAddress = logEntry.context.peerAddress;
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
