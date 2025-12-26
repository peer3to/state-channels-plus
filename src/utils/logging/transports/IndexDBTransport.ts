import Transport from "winston-transport";
import { isBrowser } from "../LoggingConfig";

/**
 * Browser storage transport using IndexedDB
 * Stores logs in browser storage with automatic rotation based on size and age
 * Uses in-memory buffering and stats tracking for performance
 */

export default class IndexDBTransport extends Transport {
    private dbName: string;
    private maxSize: number;
    private maxAge: number;
    private db: IDBDatabase | null = null;
    private initPromise: Promise<void> | null = null;

    // In-memory stats tracking
    private approxSize: number = 0;
    private oldestTimestamp: number = Infinity;
    private lastStatsPersist: number = 0;
    private statsPersistInterval: number = 60000; // Persist stats every 60s

    // Memory buffer for batching writes
    private buffer: Array<{ ts: number; line: string }> = [];
    private bufferFlushInterval: number = 5000; // Flush buffer into IndexedDB every 5s
    private bufferMaxSize: number = 100; // Max buffer size before forced flush
    private flushTimer: ReturnType<typeof setInterval> | null = null;

    // Rotation guard to prevent concurrent rotations
    private rotationInProgress: boolean = false;
    constructor(
        opts: {
            dbName?: string;
            maxSize?: number;
            maxAge?: number;
        } & Transport.TransportStreamOptions
    ) {
        super(opts);
        this.dbName = opts.dbName || "peer3_logs";
        this.maxSize = opts.maxSize || 50 * 1024 * 1024; // 50MB default
        this.maxAge = opts.maxAge || 7 * 24 * 60 * 60 * 1000; // 7 days default

        // Start periodic flush timer
        if (isBrowser()) {
            this.flushTimer = window.setInterval(() => {
                this.flushBuffer().catch((err) => {
                    console.warn(
                        "[BrowserStorageTransport] Flush failed:",
                        err
                    );
                });
            }, this.bufferFlushInterval) as any;
        } else if (typeof setInterval !== "undefined") {
            this.flushTimer = setInterval(() => {
                this.flushBuffer().catch((err) => {
                    console.warn(
                        "[BrowserStorageTransport] Flush failed:",
                        err
                    );
                });
            }, this.bufferFlushInterval);
        }

        // Flush buffer on page visibility changes and page unload
        if (isBrowser()) {
            // Flush when page becomes hidden
            document.addEventListener("visibilitychange", () => {
                if (document.visibilityState === "hidden") {
                    this.flushBuffer().catch(() => {
                        // Silently fail
                    });
                }
            });

            // Flush on page unload
            window.addEventListener("pagehide", () => {
                this.flushBuffer().catch(() => {
                    // Silently fail
                });
            });
        }
    }

    log(info: any, callback: () => void): void {
        // Use Winston's timestamp if available, otherwise use current time
        const ts =
            typeof info.timestamp === "number"
                ? info.timestamp
                : info.timestamp instanceof Date
                  ? info.timestamp.getTime()
                  : Date.now();

        // Serialize log entry to NDJSON string
        const { timestamp, ...infoWithoutTimestamp } = info;
        const logLine = JSON.stringify({
            ts,
            level: info.level,
            message: info.message,
            component: info.component,
            ...infoWithoutTimestamp
        });

        const entry = {
            ts,
            line: logLine
        };

        // Add to memory buffer
        this.buffer.push(entry);

        // Update in-memory stats
        this.approxSize += entry.line.length;
        this.oldestTimestamp = Math.min(this.oldestTimestamp, entry.ts);

        // Flush if buffer is full
        if (this.buffer.length >= this.bufferMaxSize) {
            this.flushBuffer()
                .then(() => this.rotateIfNeeded())
                .catch((err) => {
                    console.warn("[BrowserStorageTransport] Failed:", err);
                })
                .finally(() => callback());
        } else {
            // Check rotation based on in-memory stats
            const now = Date.now();
            const needsRotation =
                this.approxSize > this.maxSize ||
                now - this.maxAge > this.oldestTimestamp;

            if (needsRotation && !this.rotationInProgress) {
                // Async rotation, don't block
                this.rotateIfNeeded().catch((err) => {
                    console.warn(
                        "[BrowserStorageTransport] Rotation failed:",
                        err
                    );
                });
            }

            // Persist stats periodically
            if (now - this.lastStatsPersist > this.statsPersistInterval) {
                this.persistStats().catch(() => {
                    // Silently fail
                });
            }

            callback();
        }
    }

    private async ensureInitialized(): Promise<void> {
        if (this.db) return;
        if (this.initPromise) return this.initPromise;

        this.initPromise = new Promise((resolve, reject) => {
            if (typeof indexedDB === "undefined") {
                reject(new Error("IndexedDB not available"));
                return;
            }

            const request = indexedDB.open(this.dbName, 2); // Version 2

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                // Try to load persisted stats first (fast-start)
                // If stale or missing, reconcile with full scan
                this.loadPersistedStats()
                    .then(() => {
                        // If stats weren't loaded (stale/missing), do full reconciliation
                        if (
                            this.approxSize === 0 &&
                            this.oldestTimestamp === Infinity
                        ) {
                            return this.reconcileStats();
                        }
                    })
                    .then(() => resolve())
                    .catch(reject);
            };

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;

                // Logs store (stores NDJSON strings)
                if (!db.objectStoreNames.contains("logs")) {
                    const store = db.createObjectStore("logs", {
                        keyPath: "id",
                        autoIncrement: true
                    });
                    store.createIndex("timestamp", "ts", {
                        unique: false
                    });
                }

                // Stats store (for persisting approximate stats)
                if (!db.objectStoreNames.contains("stats")) {
                    db.createObjectStore("stats", {
                        keyPath: "key"
                    });
                }
            };
        });

        return this.initPromise;
    }

    /**
     * Flush memory buffer to IndexedDB
     */
    private async flushBuffer(): Promise<void> {
        if (this.buffer.length === 0) return;

        await this.ensureInitialized();
        if (!this.db) return;

        const entries = this.buffer.splice(0); // Clear buffer

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction(["logs"], "readwrite");
            const store = transaction.objectStore("logs");

            let completed = 0;
            const total = entries.length;

            if (total === 0) {
                resolve();
                return;
            }

            entries.forEach((entry) => {
                const request = store.add(entry);
                request.onsuccess = () => {
                    completed++;
                    if (completed === total) {
                        resolve();
                    }
                };
                request.onerror = () => {
                    reject(request.error);
                };
            });
        });
    }

    /**
     * Load persisted stats from DB (fast-start)
     */
    private async loadPersistedStats(): Promise<void> {
        if (!this.db) return;

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction(["stats"], "readonly");
            const store = transaction.objectStore("stats");
            const request = store.get("current");

            request.onsuccess = () => {
                const stats = request.result;
                if (stats && stats.lastUpdated) {
                    // Use persisted stats if they're recent (within 5 minutes)
                    const age = Date.now() - stats.lastUpdated;
                    if (age < 5 * 60 * 1000) {
                        this.approxSize = stats.size || 0;
                        this.oldestTimestamp =
                            stats.oldestTimestamp !== undefined
                                ? stats.oldestTimestamp
                                : Infinity;
                        this.lastStatsPersist = stats.lastUpdated;
                        resolve();
                        return;
                    }
                }
                // Stats are stale or missing, will reconcile
                resolve();
            };

            request.onerror = () => {
                // If stats store doesn't exist or error, just continue
                resolve();
            };
        });
    }

    /**
     * Reconcile in-memory stats with actual DB state (full scan)
     * Only called when persisted stats are stale or after rotation
     */
    private async reconcileStats(): Promise<void> {
        if (!this.db) return;

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction(["logs"], "readonly");
            const store = transaction.objectStore("logs");
            const index = store.index("timestamp");
            const request = index.openCursor();

            let size = 0;
            let oldest = Date.now();
            let count = 0;

            request.onsuccess = () => {
                const cursor = request.result;
                if (!cursor) {
                    this.approxSize = size;
                    this.oldestTimestamp =
                        oldest === Infinity ? Infinity : oldest;
                    resolve();
                    return;
                }

                const entry = cursor.value;
                size += entry.line.length;
                oldest = Math.min(oldest, entry.ts);
                count++;

                cursor.continue();
            };

            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Persist stats to DB (periodic reconciliation)
     */
    private async persistStats(): Promise<void> {
        if (!this.db) return;

        this.lastStatsPersist = Date.now();

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction(["stats"], "readwrite");
            const store = transaction.objectStore("stats");
            const request = store.put({
                key: "current",
                size: this.approxSize,
                oldestTimestamp: this.oldestTimestamp,
                lastUpdated: this.lastStatsPersist
            });

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Rotation logic with proper deletion strategies:
     * 1. Delete by age (oldest entries beyond maxAge)
     * 2. Delete oldest until size < maxSize
     */
    private async rotateIfNeeded(): Promise<void> {
        // Guard against concurrent rotations
        if (this.rotationInProgress) {
            return;
        }

        this.rotationInProgress = true;

        try {
            await this.flushBuffer(); // Ensure buffer is flushed before rotation
            if (!this.db) return;

            const now = Date.now();
            const ageThreshold = now - this.maxAge;

            // Strategy 1: Delete by age
            if (this.oldestTimestamp < ageThreshold) {
                await this.deleteByAge(ageThreshold);
            }

            // Strategy 2: Delete oldest until size < maxSize
            if (this.approxSize > this.maxSize) {
                await this.deleteUntilSizeLimit();
            }

            // Reconcile stats after rotation
            await this.reconcileStats();
        } finally {
            this.rotationInProgress = false;
        }
    }

    /**
     * Delete entries older than ageThreshold
     */
    private async deleteByAge(ageThreshold: number): Promise<void> {
        if (!this.db) return;

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction(["logs"], "readwrite");
            const store = transaction.objectStore("logs");
            const index = store.index("timestamp");
            const request = index.openCursor(
                IDBKeyRange.upperBound(ageThreshold)
            );

            let deleted = 0;

            request.onsuccess = () => {
                const cursor = request.result;
                if (!cursor) {
                    // All deletions done — now find new oldest in O(1)
                    const req = index.openCursor(); // first = oldest
                    req.onsuccess = () => {
                        this.oldestTimestamp = req.result
                            ? req.result.value.ts
                            : Infinity;
                        resolve();
                    };
                    req.onerror = () => reject(req.error);

                    return;
                }

                const entry = cursor.value;
                this.approxSize -= entry.line.length;
                deleted++;
                cursor.delete();
                cursor.continue();
            };

            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Delete oldest entries until size < maxSize
     */
    private async deleteUntilSizeLimit(): Promise<void> {
        if (!this.db) return;

        return new Promise((resolve, reject) => {
            const tx = this.db!.transaction(["logs"], "readwrite");
            const store = tx.objectStore("logs");
            const index = store.index("timestamp");
            const req = index.openCursor(); // Start from oldest

            req.onsuccess = () => {
                const cursor = req.result;

                // No entries left to delete
                if (!cursor) {
                    this.oldestTimestamp = Infinity;
                    resolve();
                    return;
                }

                // Still over limit, delete this entry
                if (this.approxSize > this.maxSize) {
                    const entry = cursor.value;
                    this.approxSize -= entry.line.length;
                    cursor.delete();
                    cursor.continue();
                    return;
                }

                // First surviving entry = new oldest
                this.oldestTimestamp = cursor.value.ts;
                resolve();
            };

            req.onerror = () => reject(req.error);
        });
    }

    /**
     * Get all logs (for crash handler)
     * Returns parsed log objects from NDJSON strings
     */
    async getAllLogs(): Promise<any[]> {
        await this.flushBuffer(); // Ensure buffer is flushed
        await this.ensureInitialized();
        if (!this.db) return [];

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction(["logs"], "readonly");
            const store = transaction.objectStore("logs");
            const index = store.index("timestamp");
            const request = index.openCursor();

            const logs: any[] = [];

            request.onsuccess = () => {
                const cursor = request.result;
                if (!cursor) {
                    // Parse NDJSON strings to objects
                    const parsed = logs.map((entry) => {
                        try {
                            return JSON.parse(entry.line);
                        } catch {
                            return {
                                timestamp: entry.ts,
                                level: "error",
                                message: "Failed to parse log entry",
                                raw: entry.line
                            };
                        }
                    });
                    resolve(parsed);
                    return;
                }

                logs.push(cursor.value);
                cursor.continue();
            };

            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Flush buffer and force rotation check
     */
    async flush(): Promise<void> {
        await this.flushBuffer();
        await this.rotateIfNeeded();
    }

    async clearLogs(): Promise<void> {
        await this.flushBuffer(); // Flush before clearing
        await this.ensureInitialized();
        if (!this.db) return;

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction(["logs"], "readwrite");
            const store = transaction.objectStore("logs");
            const request = store.clear();

            request.onsuccess = async () => {
                // Reset stats
                this.approxSize = 0;
                this.oldestTimestamp = Infinity;
                // Persist cleared stats to avoid resurrecting old stats on reload
                try {
                    await this.persistStats();
                } catch (err) {
                    // Silently fail - stats persistence is best-effort
                }
                resolve();
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Cleanup: clear timer on destroy
     */
    close(): void {
        if (this.flushTimer) {
            if (typeof window !== "undefined" && window.clearInterval) {
                window.clearInterval(this.flushTimer as any);
            } else if (typeof clearInterval !== "undefined") {
                clearInterval(this.flushTimer);
            }
            this.flushTimer = null;
        }
    }
}
