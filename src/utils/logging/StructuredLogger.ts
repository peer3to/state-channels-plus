import winston from "winston";
import { LogEventType } from "./LogEvents";
import { randomBytes } from "crypto";
import { Address, BlockHeight, ChannelId, ForkId } from "@/types/types";

/**
 * Context provider function - automatically adds channel/peer/trace context
 */
export type LogContext = {
    channelId?: ChannelId;
    forkId?: ForkId;
    peer?: Address;
    height?: BlockHeight;
    traceId?: string;
    [key: string]: any; // Allow additional properties
};

export type ContextProvider = () => LogContext;

/**
 * Generate a short trace ID (8 chars hex)
 */
function generateTraceId(): string {
    return randomBytes(4).toString("hex");
}

/**
 * Structured logger that wraps Winston and provides:
 * 1. Structured event logging (JSON-serializable)
 * 2. Concise API
 * 3. Auto-context injection (channel, peer, fork, trace)
 * 4. Better console output
 * 5. Trace-aware child loggers
 */
export class StructuredLogger {
    private winston: winston.Logger;
    private component: string;
    private getContext: ContextProvider;

    constructor(
        winstonLogger: winston.Logger,
        component: string,
        contextProvider?: ContextProvider
    ) {
        this.winston = winstonLogger;
        this.component = component;
        this.getContext = contextProvider || (() => ({}));
    }

    private logEvent(
        level: "error" | "warn" | "info" | "debug" | "verbose",

        options?: {
            event?: LogEventType;
            message?: string;
            data?: Record<string, any>;
            err?: any;
            [key: string]: any; // Allow overriding context
        }
    ): void {
        const ctx = this.getContext();

        const parts: string[] = [];

        if (options?.event) {
            parts.push(`<${options.event}>`);
        }

        parts.push(options?.message ?? "");

        // Error details (show error message inline for quick visibility)
        if (options?.err) {
            const errorMsg = options.err?.message || String(options.err);
            // Extract short error code if it looks like an EVM error
            const shortError =
                errorMsg.match(/'([^']+)'/)?.[1] || errorMsg.slice(0, 50);
            parts.push(`"${shortError}"`);
        }

        // Context - merge from context provider and options
        const mergedContext = { ...ctx, ...options };
        const ctxParts: string[] = [];
        if (mergedContext.channelId)
            ctxParts.push(`ch:${mergedContext.channelId}`);
        if (mergedContext.forkId && mergedContext.forkId !== "0x00")
            ctxParts.push(`fork:${mergedContext.forkId}`);
        if (mergedContext.height !== undefined)
            ctxParts.push(`h:${mergedContext.height}`);
        if (ctxParts.length > 0) {
            parts.push(`{${ctxParts.join(" ")}}`);
        }

        // Data - only show additional data not already in context
        if (options?.data && Object.keys(options.data).length > 0) {
            parts.push(JSON.stringify(options.data));
        }

        const formattedMessage = parts.join(" ");

        const meta: any = {
            component: this.component
        };
        if (mergedContext.traceId) {
            meta.traceId = mergedContext.traceId; // PeerLogger will format it as [traceId]
        }

        this.winston.log(level, formattedMessage, meta);
    }

    info(
        messageOrOptions?: string | Parameters<typeof this.logEvent>[1],
        data?: any
    ): void {
        if (typeof messageOrOptions === "string") {
            this.logEvent("info", { message: messageOrOptions, data });
        } else {
            this.logEvent("info", messageOrOptions);
        }
    }

    warn(
        messageOrOptions?: string | Parameters<typeof this.logEvent>[1],
        data?: any
    ): void {
        if (typeof messageOrOptions === "string") {
            this.logEvent("warn", { message: messageOrOptions, data });
        } else {
            this.logEvent("warn", messageOrOptions);
        }
    }

    error(
        errorOrMessage?: any,
        optionsOrData?: Parameters<typeof this.logEvent>[1] | any
    ): void {
        if (typeof errorOrMessage === "string") {
            // Old API: error(message, data)
            this.logEvent("error", {
                message: errorOrMessage,
                data: optionsOrData
            });
        } else if (
            errorOrMessage instanceof Error ||
            (errorOrMessage && typeof errorOrMessage === "object")
        ) {
            // New API: error(error, options) or error(options)
            if (
                optionsOrData &&
                typeof optionsOrData === "object" &&
                !Array.isArray(optionsOrData)
            ) {
                this.logEvent("error", {
                    ...optionsOrData,
                    err: errorOrMessage
                });
            } else {
                this.logEvent("error", { err: errorOrMessage });
            }
        } else {
            this.logEvent("error", optionsOrData);
        }
    }

    debug(
        messageOrOptions?: string | Parameters<typeof this.logEvent>[1],
        data?: any
    ): void {
        if (typeof messageOrOptions === "string") {
            this.logEvent("debug", { message: messageOrOptions, data });
        } else {
            this.logEvent("debug", messageOrOptions);
        }
    }

    verbose(
        messageOrOptions?: string | Parameters<typeof this.logEvent>[1],
        data?: any
    ): void {
        if (typeof messageOrOptions === "string") {
            this.logEvent("verbose", { message: messageOrOptions, data });
        } else {
            this.logEvent("verbose", messageOrOptions);
        }
    }

    /**
     * Concise methods for common patterns
     */

    // State transition
    tx(txCnt: number, participant: string, success: boolean, data?: any): void {
        this.logEvent(success ? "info" : "warn", {
            event: success
                ? LogEventType.TX_EXECUTED
                : LogEventType.BLOCK_VALIDATION_FAILED,
            message: `${success ? "Executed" : "Failed"} tx #${txCnt} by ${participant.slice(0, 8)}`,
            data: {
                participant: participant.slice(0, 10),
                ...data
            }
        });
    }

    // Block event
    block(
        height: number,
        action: "created" | "confirmed" | "rejected",
        data?: any
    ): void {
        this.logEvent(action === "rejected" ? "warn" : "info", {
            event:
                action === "created"
                    ? LogEventType.BLOCK_CREATED
                    : action === "confirmed"
                      ? LogEventType.BLOCK_CONFIRMED
                      : LogEventType.BLOCK_VALIDATION_FAILED,
            message: `${action} block #${height}`,
            height,
            data
        });
    }

    // Dispute event
    dispute(action: LogEventType, disputeHash: string, data?: any): void {
        this.logEvent("warn", {
            event: action,
            data: { disputeHash: disputeHash.slice(0, 16), ...data }
        });
    }

    // RPC call
    rpc(
        method: string,
        direction: "send" | "recv",
        peer: string,
        data?: any
    ): void {
        this.logEvent("debug", {
            event:
                direction === "recv"
                    ? LogEventType.RPC_CALL
                    : LogEventType.RPC_RESPONSE,
            message: `RPC ${direction} ${method} ${direction === "send" ? "to" : "from"} ${peer.slice(0, 8)}`,
            data: { method, direction, peer: peer.slice(0, 10), ...data }
        });
    }

    /**
     * Create child logger with additional context

     */
    child(
        additionalContext: Partial<LogContext> | ContextProvider
    ): StructuredLogger {
        const parentContext = this.getContext;
        const newContextProvider: ContextProvider =
            typeof additionalContext === "function"
                ? () => ({ ...parentContext(), ...additionalContext() })
                : () => ({ ...parentContext(), ...additionalContext });

        return new StructuredLogger(
            this.winston,
            this.component,
            newContextProvider
        );
    }

    /**
     * Create a trace-scoped child logger with auto-generated trace ID

     */
    trace(traceId?: string): StructuredLogger {
        return this.child({ traceId: traceId || generateTraceId() });
    }

    /**
     * Block-specific logging helpers that automatically include block context
     * (hash, height, forkId) to reduce repetition
     */
    blockWarn(
        block: { hash: any; height: number; forkId: any },
        message: string,
        data?: any
    ): void {
        const blockHash = String(block.hash);
        const forkId = String(block.forkId);
        this.logEvent("warn", {
            message,
            height: block.height,
            forkId: forkId,

            data: {
                blockHash: blockHash.slice(0, 12),
                ...data
            }
        });
    }

    blockInfo(
        block: { hash: any; height: number; forkId: any },
        message: string,
        data?: any,
        event?: LogEventType
    ): void {
        const blockHash = String(block.hash);
        const forkId = String(block.forkId);
        this.logEvent("info", {
            event,
            message,
            height: block.height,
            forkId: forkId,
            data: {
                blockHash: blockHash.slice(0, 12),
                ...data
            }
        });
    }

    blockError(
        block: { hash: any; height: number; forkId: any },
        message: string,
        err?: any,
        data?: any
    ): void {
        const blockHash = String(block.hash);
        const forkId = String(block.forkId);
        this.logEvent("error", {
            message,
            err,
            height: block.height,
            forkId: forkId,
            data: {
                blockHash: blockHash.slice(0, 12),
                ...data
            }
        });
    }

    blockDebug(
        block: { hash: any; height: number; forkId: any },
        message: string,
        data?: any
    ): void {
        const blockHash = String(block.hash);
        const forkId = String(block.forkId);
        this.logEvent("debug", {
            message,
            height: block.height,
            forkId: forkId,
            data: {
                blockHash: blockHash.slice(0, 12),
                ...data
            }
        });
    }
}
