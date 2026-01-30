import { LoggerContext } from "./types";

export type StoredLog = {
    ts: number;
    level: string;
    message: string;
    component?: string;
    peerId?: number;
    peerAddress?: string;
    [key: string]: any;
};

export type LogObserver = (entry: StoredLog) => void;

let observer: LogObserver | null = null;

export function setLogObserver(fn: LogObserver | null): void {
    observer = fn;
}

// Shared log storage helper
export function createLogStore(maxSize: number, enabled: boolean) {
    const logs: Array<{ entry: any; size: number }> = [];
    let currentSize = 0;

    return {
        store(
            level: string,
            message: any,
            context: LoggerContext,
            meta?: any
        ): void {
            if (!enabled) return;

            const logEntry: StoredLog = {
                ts: Date.now(),
                level,
                message:
                    typeof message === "string" ? message : String(message),
                component: context.component,
                ...context,
                ...(meta && typeof meta === "object" ? meta : {})
            };

            // Use replacer to handle BigInt serialization
            const entrySize =
                JSON.stringify(logEntry, (_key, v) =>
                    typeof v === "bigint" ? v.toString() : v
                ).length * 2;
            logs.push({ entry: logEntry, size: entrySize });
            currentSize += entrySize;

            // Notify observer
            if (observer) observer(logEntry);

            // Maintain circular buffer
            while (currentSize > maxSize && logs.length > 0) {
                const removed = logs.shift();
                if (removed) {
                    currentSize -= removed.size;
                }
            }
        },

        getAllLogs(): any[] {
            return logs.map((item) => item.entry);
        },

        clearLogs(): void {
            logs.length = 0;
            currentSize = 0;
        }
    };
}
