// Browser-only memory transport for logging
export default class MemoryTransport {
    private logs: Array<{ entry: any; size: number }> = [];
    private currentSize: number = 0;
    private maxSize: number;

    constructor(opts: { maxSize?: number } = {}) {
        this.maxSize = opts.maxSize || 10 * 1024 * 1024; // 10MB default
    }

    log(info: any, callback: () => void): void {
        // Use Winston's timestamp if available, otherwise use current time
        const ts =
            typeof info.timestamp === "number"
                ? info.timestamp
                : info.timestamp instanceof Date
                  ? info.timestamp.getTime()
                  : Date.now();

        // Store the log entry
        const { timestamp, component, ...rest } = info;
        const logEntry = {
            ts,
            level: info.level,
            message: info.message,
            component,
            ...rest
        };

        // Calculate approximate size (JSON string length * 2 for UTF-16 encoding in JS)
        const entrySize = JSON.stringify(logEntry).length * 2;

        this.logs.push({ entry: logEntry, size: entrySize });
        this.currentSize += entrySize;

        // Maintain circular buffer - remove oldest logs until under size limit
        while (this.currentSize > this.maxSize && this.logs.length > 0) {
            const removed = this.logs.shift();
            if (removed) {
                this.currentSize -= removed.size;
            }
        }

        callback();
    }

    getAllLogs(): any[] {
        return this.logs.map((item) => item.entry);
    }

    clearLogs(): void {
        this.logs = [];
        this.currentSize = 0;
    }
}
