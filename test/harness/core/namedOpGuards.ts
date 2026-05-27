// W1 §6 bucket (iii) - runtime guards for the named-op transition surface.
// shared by InlinePeer + WorkerPeer; the closure-capture analyser (W0 D-11)
// is the permanent write-time guardrail. these runtime checks are a backstop
// so a stray lambda in dev mode fails fast with a clear migration error
// instead of a confusing structured-clone failure at the rpc boundary.

import type { NamedOpRequest, PeerHandle } from "./PeerHandle";

// step 1 - generic guard for closure-bearing action methods. inline mode runs
// the lambda in-process; worker mode rejects with a clear migration error
// pointing to the named-op pattern. action classes call this BEFORE invoking
// the lambda when the action surface still accepts a lambda overload (W0 D-22).
export function rejectClosureInWorkerMode(
    label: string,
    handle: PeerHandle
): void {
    // step 1 - WorkerPeer brands itself via __workerBackend on PeerHandle.
    // duck-type check avoids importing WorkerPeer here -> no cycle.
    if (handle.__workerBackend) {
        throw new Error(
            `${label}: closure-bearing call not supported in worker mode (W0 D-22). ` +
                `migrate test source to the named-op shape and register the op ` +
                `via registerOp() in your worker-ops domain module.`
        );
    }
}

export function rejectLambdaArgs(label: string, req: NamedOpRequest): void {
    const probe = req as NamedOpRequest & { txFn?: unknown };
    if (typeof probe.txFn === "function") {
        throw new Error(
            `${label}: function-typed 'txFn' is not supported. closures never cross ` +
                `the orchestrator <-> worker boundary (W0 D-11). migrate to the ` +
                `named-op shape: { op: '<domain>.<opId>', args: {...} } and register ` +
                `the op via registerOp() in your worker-ops domain module.`
        );
    }
    if (typeof req.args === "function") {
        throw new Error(
            `${label}: function-typed 'args' is not supported. args must be ` +
                `structured-cloneable. ${typeof req.args}.`
        );
    }
}
