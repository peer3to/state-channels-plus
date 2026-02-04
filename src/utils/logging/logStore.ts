import { LogEntry } from "./Logger";
import { encodeLogEntry } from "./logEncoder";

// Shared log storage helper (instance-based)
export class LogStore {
    private logs: Array<{ entry: LogEntry; sizeInBytes: number }> = [];
    private currentSize = 0;

    constructor(
        private readonly maxSize: number,
        private readonly enabled: boolean
    ) {}

    store(logEntry: LogEntry): void {
        if (!this.enabled) return;

        const serializedLog = encodeLogEntry(logEntry);

        const entrySize = serializedLog.length * 2; // 2* since the serialized string is UTF-16
        this.logs.push({ entry: logEntry, sizeInBytes: entrySize });
        this.currentSize += entrySize;

        // Maintain circular buffer
        while (this.currentSize > this.maxSize && this.logs.length > 0) {
            const removed = this.logs.shift();
            if (removed) {
                this.currentSize -= removed.sizeInBytes;
            }
        }
    }

    getAllLogs(): LogEntry[] {
        return this.logs.map((item) => item.entry);
    }

    clearLogs(): void {
        this.logs.length = 0;
        this.currentSize = 0;
    }
}
