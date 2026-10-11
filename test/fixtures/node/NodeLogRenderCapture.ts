// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import { LogStore } from "@/utils/logging/logStore";
import { NodeLogger } from "@/utils/logging/node/NodeLogger";
import {
    THREAD_LABEL_COMPONENT,
    THREAD_LABEL_MESSAGE,
    threadLabelSharedContext
} from "@test/fixtures/logging/ThreadLabelExpectation";

// ANSI color sequences the Node logger wraps each prefix part in.
const ANSI_COLOR = /\x1b\[[0-9;]*m/g;

/**
 * Writes the thread-label message at info level through a real NodeLogger and
 * returns every line it rendered on the console, color codes removed. The
 * console sink is captured for that one write only.
 */
export function renderNodeThreadLabelLines(
    threadName: string | undefined
): string[] {
    const logger = new NodeLogger(
        { component: THREAD_LABEL_COMPONENT },
        threadLabelSharedContext(threadName),
        "info",
        new LogStore(1024 * 1024, false)
    );
    const lines: string[] = [];
    const { groupCollapsed, groupEnd, log } = console;
    console.groupCollapsed = (...parts: unknown[]) => {
        lines.push(parts.map(String).join(" "));
    };
    // The meta and stack lines inside the group are not under test.
    console.log = () => {};
    console.groupEnd = () => {};
    try {
        logger.info(THREAD_LABEL_MESSAGE);
    } finally {
        Object.assign(console, { groupCollapsed, groupEnd, log });
        logger.dispose();
    }
    return lines.map((line) => line.replace(ANSI_COLOR, ""));
}
