// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import type { LogEntry } from "@/utils/logging/Logger";

export function logStoreEntry(message: string): LogEntry {
    return {
        time: "1",
        wallTimeMs: 1,
        level: "info",
        context: { component: "LogStoreTest" },
        sharedContext: { threadName: "main" },
        message,
        meta: [],
        stack: "stack"
    };
}
