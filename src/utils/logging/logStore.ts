import { LoggerContext } from "./types";

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

            const logEntry = {
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
