import type { SharedLoggerContext } from "./Logger";

/** ties a round to its acks */
export type FlushId = string;

/** which end of the tree the realm across a port sits on -> how much of its
 *  context this realm trusts */
export type LogRemoteRealm = "parent" | "child";

export interface LogControl<TType extends string> {
    type: TType;
}

/** upload every store reachable from the receiving realm */
export interface LogFlushRequest extends LogControl<"flushRequest"> {
    flushId: FlushId;
    /** human-readable trigger */
    reason: string;
}

/** what a round achieved across every realm it reached */
export interface LogFlushResult {
    /** realms that uploaded, or had nothing new */
    ok: number;
    /** realms whose POST failed after its retry */
    failed: number;
    /** ports that never acked in time */
    timedOut: number;
    /** entries the server accepted */
    entries: number;
}

/** sent back on the port a round arrived on */
export interface LogFlushAck extends LogControl<"flushAck"> {
    flushId: FlushId;
    /** rolled up from this subtree */
    result: LogFlushResult;
}

/** the sender's channel or identity changed */
export interface LogContextUpdate extends LogControl<"contextUpdate"> {
    context: SharedLoggerContext;
}

export type LogControlMessage =
    | LogFlushRequest
    | LogFlushAck
    | LogContextUpdate;

/** this realm's end of a thread boundary */
export interface LogControlPort {
    post(message: LogControlMessage): void;
    remoteRealm: LogRemoteRealm;
}

/** what a transport keeps for its port. receive() closes over the port, so it
 *  can't be paired with the wrong one. */
export interface LogPortHandle {
    /** feed the bus a message that arrived on this port */
    receive(message: LogControlMessage): void;
    /** detach; waiters on its ack settle now */
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
