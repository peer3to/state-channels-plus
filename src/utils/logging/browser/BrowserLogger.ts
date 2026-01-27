import { config } from "../../config";
import { Logger, LoggerContext } from "../types";
import { createLogStore } from "../logStore";
import { formatTime } from "../formatUtils";
import { BROWSER_PEER_COLORS, BROWSER_LEVEL_CSS } from "./colors";

export class BrowserLogger implements Logger {
    public level?: string;
    private context: LoggerContext;
    private logStore: ReturnType<typeof createLogStore>;
    private enableMemoryStorage: boolean;

    constructor(
        context: LoggerContext = {},
        level?: string,
        enableMemoryStorage: boolean = false
    ) {
        this.context = context;
        this.level = level;
        this.enableMemoryStorage = enableMemoryStorage;
        const maxSize = (config.CRASH_LOG_MAX_SIZE_MB || 10) * 1024 * 1024;
        this.logStore = createLogStore(maxSize, enableMemoryStorage);
    }

    public child(context: LoggerContext): Logger {
        return new BrowserLogger(
            { ...this.context, ...(context || {}) },
            this.level,
            this.enableMemoryStorage
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

    private levelCss(level: string): string {
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

    private logWithStack(
        level: "debug" | "info" | "warn" | "error" | "verbose",
        message: any,
        meta?: any,
        ...args: any[]
    ): void {
        const method = level === "verbose" ? "debug" : level;
        const details = {
            args,
            meta
        };

        if (
            console.groupCollapsed &&
            level !== "debug" &&
            level !== "verbose" // don't use groups for debug/verbose since group labels are always INFO...
        ) {
            // eslint-disable-next-line no-console
            console.groupCollapsed(...this.fmt(level, message));
            // eslint-disable-next-line no-console
            console[method](details);
            // eslint-disable-next-line no-console
            console[method](new Error().stack);
            // eslint-disable-next-line no-console
            console.groupEnd();
            return;
        }

        // Fallback when groups are not supported
        // eslint-disable-next-line no-console
        (console as any)[method](
            ...this.fmt(level, message),
            details,
            new Error().stack
        );
    }

    private fmt(level: string, message: any): any[] {
        const merged = { ...this.context };

        const time = formatTime();
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

        // Reset style after prefix so message is default console color.
        parts.push(`%c`);
        styles.push("");

        const prefix = `${parts.join("")}`;
        return [prefix, ...styles, message];
    }

    public debug(message: any, meta?: any, ...args: any[]): void {
        this.storeLog("debug", message, meta);
        // eslint-disable-next-line no-console
        this.logWithStack("debug", message, meta, ...args);
    }
    public info(message: any, meta?: any, ...args: any[]): void {
        this.storeLog("info", message, meta);
        // eslint-disable-next-line no-console
        this.logWithStack("info", message, meta, ...args);
    }
    public warn(message: any, meta?: any, ...args: any[]): void {
        this.storeLog("warn", message, meta);
        // eslint-disable-next-line no-console
        this.logWithStack("warn", message, meta, ...args);
    }
    public error(message: any, meta?: any, ...args: any[]): void {
        this.storeLog("error", message, meta);
        // eslint-disable-next-line no-console
        this.logWithStack("error", message, meta, ...args);
    }
    public verbose(message: any, meta?: any, ...args: any[]): void {
        this.storeLog("verbose", message, meta);
        // eslint-disable-next-line no-console
        this.logWithStack("verbose", message, meta, ...args);
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
