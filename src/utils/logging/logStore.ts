import { LogEntry } from "./Logger";
import { encodeLogEntry } from "./logEncoder";

// Shared log storage helper (instance-based)
export class LogStore {
    private logs: Array<{ entry: LogEntry; sizeInBytes: number; seq: number }> =
        [];
    private currentSize = 0;
    private nextSeq = 0; // monotonic; never reset by eviction

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

        // Maintain circular buffer (evicts oldest seqs from the front)
        while (this.currentSize > this.maxSize && this.logs.length > 0) {
            const removed = this.logs.shift();
            if (removed) {
                this.currentSize -= removed.sizeInBytes;
            }
        }
    }

    // Entries with seq > sinceSeq. Buffer is always a contiguous seq run, so
    // fromSeq is the oldest retained seq past the cursor (a fromSeq jump past
    // sinceSeq+1 means eviction outran the cursor — acceptable loss).
    getLogsSince(sinceSeq: number): {
        entries: LogEntry[];
        fromSeq: number;
        toSeq: number;
    } {
        const fresh = this.logs.filter((item) => item.seq > sinceSeq);
        if (fresh.length === 0) {
            return { entries: [], fromSeq: sinceSeq + 1, toSeq: sinceSeq };
        }
        return {
            entries: fresh.map((item) => item.entry),
            fromSeq: fresh[0].seq,
            toSeq: fresh[fresh.length - 1].seq
        };
    }

    getAllLogs(): LogEntry[] {
        return this.logs.map((item) => item.entry);
    }

    clearLogs(): void {
        this.logs.length = 0;
        this.currentSize = 0;
    }
}
