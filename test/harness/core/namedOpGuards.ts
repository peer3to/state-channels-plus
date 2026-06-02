// Runtime guards for the named-op transition surface shared by InlinePeer and WorkerPeer.
// These checks ensure closure-bearing calls fail fast with a clear migration error
// instead of a late structured-clone failure at the RPC boundary.

import type { NamedOpRequest, PeerHandle } from "./PeerHandle";

// Generic guard for closure-bearing action methods.
// Inline mode runs the lambda in-process; worker mode rejects and points to the named-op pattern.
// Action classes call this before invoking the lambda when a lambda overload is still supported.
export function rejectClosureInWorkerMode(
    label: string,
    handle: PeerHandle
): void {
    // WorkerPeer brands itself via __workerBackend on PeerHandle.
    // Duck-typing avoids importing WorkerPeer here and keeps this file decoupled.
    if (handle.__workerBackend) {
        throw new Error(
            `${label}: closure-bearing call not supported in worker mode. ` +
                `migrate test source to the named-op shape: { op: '<domain>.<opId>', args: {...} }.`
        );
    }
}

export function rejectLambdaArgs(label: string, req: NamedOpRequest): void {
    const probe = req as NamedOpRequest & { txFn?: unknown };
    if (typeof probe.txFn === "function") {
        throw new Error(
            `${label}: function-typed 'txFn' is not supported. closures never cross ` +
                `the orchestrator <-> worker boundary. migrate to the named-op shape: ` +
                `{ op: '<domain>.<opId>', args: {...} }.`
        );
    }
    if (typeof req.args === "function") {
        throw new Error(
            `${label}: function-typed 'args' is not supported. args must be ` +
                `structured-cloneable. ${typeof req.args}.`
        );
    }
}
