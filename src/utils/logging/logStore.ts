import { LogEntry } from "./Logger";
import { encodeLogEntry } from "./logEncoder";

/** entries newer than a cursor. fromSeq > sinceSeq + 1 means eviction outran it;
 *  the chunk names keep that gap. */
export type LogStoreDelta = {
    entries: LogEntry[];
    fromSeq: number;
    toSeq: number;
};

// Shared log storage helper (instance-based)
export class LogStore {
    /** distinguishes one process's stream from the next: seq restarts at 0 per
     *  store, so without it a second run overwrites the first's chunks */
    public readonly storeId: string = Array.from({ length: 2 }, () =>
        Math.floor(Math.random() * 0xffff)
            .toString(16)
            .padStart(4, "0")
    ).join("");
    private logs: Array<{ entry: LogEntry; sizeInBytes: number; seq: number }> =
        [];
    private currentSize = 0;
    // monotonic for the life of the store -> an uploader's watermark keeps meaning
    private nextSeq = 0;

    constructor(
        private readonly maxSize: number,
        private readonly enabled: boolean
    ) {}

    store(logEntry: LogEntry): void {
        if (!this.enabled) return;

        const serializedLog = encodeLogEntry(logEntry);

        const entrySize = serializedLog.length * 2; // 2* since the serialized string is UTF-16
        this.logs.push({
            entry: logEntry,
            sizeInBytes: entrySize,
            seq: this.nextSeq++
        });
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

    // sequences are contiguous in the buffer -> slice, not filter
    getLogsSince(sinceSeq: number): LogStoreDelta {
        const empty: LogStoreDelta = {
            entries: [],
            fromSeq: sinceSeq + 1,
            toSeq: sinceSeq
        };
        if (this.logs.length === 0) return empty;

        const startIndex = Math.max(0, sinceSeq + 1 - this.logs[0].seq);
        if (startIndex >= this.logs.length) return empty;

        const slice = this.logs.slice(startIndex);
        return {
            entries: slice.map((item) => item.entry),
            fromSeq: slice[0].seq,
            toSeq: slice[slice.length - 1].seq
        };
    }

    clearLogs(): void {
        this.logs.length = 0;
        this.currentSize = 0;
    }
}
