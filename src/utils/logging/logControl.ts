import type { WorkerLinkSide } from "@/rpc/WorkerLinks";
import type { SharedLoggerContext } from "./Logger";

/** which end of the tree the realm across a link sits on -> how much of its
 *  context this realm trusts */
export type LogRemoteRealm = WorkerLinkSide;

/** what a round achieved across every realm it reached */
export interface LogFlushResult {
    /** realms that uploaded, or had nothing new */
    ok: number;
    /** realms whose POST failed after its retry */
    failed: number;
    /** links that never answered in time */
    timedOut: number;
    /** entries the server accepted */
    entries: number;
}

/** this realm's end of a link, as the bus sees it: one call that collects the
 *  far subtree and answers with its totals, one cast that pushes context */
export interface LogControlPort {
    flush(reason: string): Promise<LogFlushResult>;
    postContext(context: SharedLoggerContext): void;
    remoteRealm: LogRemoteRealm;
}

/** what the bus hands back for a port: the way to take it off again */
export interface LogPortHandle {
    /** detach; a round in flight over it settles when the link closes */
    remove(): void;
}

/** a round that reached nothing */
export function emptyFlushResult(): LogFlushResult {
    return { ok: 0, failed: 0, timedOut: 0, entries: 0 };
}

/** roll a subtree's parts into one result */
export function sumFlushResults(
    parts: readonly LogFlushResult[]
): LogFlushResult {
    const total = emptyFlushResult();
    for (const part of parts) {
        total.ok += part.ok;
        total.failed += part.failed;
        total.timedOut += part.timedOut;
        total.entries += part.entries;
    }
    return total;
}
