// @spec-test-coverage-ignore: a real node logger whose entries a test reads back; no test declarations
import type { LogEntry, Logger } from "@/utils/logging/Logger";
import { LogStore } from "@/utils/logging/logStore";
import { NodeLogger } from "@/utils/logging/node/NodeLogger";

/** A logger whose entries the test reads back. */
export function recordingLogger(level: "debug" | "warn"): {
    logger: Logger;
    entries: () => LogEntry[];
} {
    const store = new LogStore(1024 * 1024, true);
    const logger = new NodeLogger(
        {},
        {},
        level,
        store,
        { attachErrorListener: false },
        new Set(),
        true
    );
    return { logger, entries: () => store.getAllLogs() };
}
