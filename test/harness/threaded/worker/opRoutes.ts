// W1 §6 bucket (iii) - worker-side rpc dispatch for named ops. orchestrator's
// WorkerPeer.transition.submitNext({op, args}) ships a transition.runOp rpc;
// this route looks up the op id in the registry and runs it with the
// per-isolate WorkerOpContext.
//
// W0 D-11 - lambdas NEVER cross; only the op id (string) + structured-cloneable
// args travel. inline backend invokes the same op table in-process via
// invokeOpInline().

import type { RpcServer } from "../rpc/rpc-server";
import { getOp, type WorkerOpContext } from "./opsRegistry";

export const TRANSITION_RUN_OP = "transition.runOp";

export function registerWorkerOpRoutes(
    server: RpcServer,
    ctx: WorkerOpContext
): void {
    server.register(TRANSITION_RUN_OP, async (req) => {
        const { op, args } = (req ?? {}) as { op?: string; args?: unknown };
        if (typeof op !== "string") {
            throw new Error(
                "transition.runOp: missing 'op' string. " +
                    "named-op shape: { op: 'domain.opId', args: {...} }"
            );
        }
        const fn = getOp(op);
        return await fn(ctx, args);
    });
}
