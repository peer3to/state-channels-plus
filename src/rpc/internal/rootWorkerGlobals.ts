// Must run before any EVM/stream import pulls in Node globals.
import { applyNodeGlobalsShim } from "@/evm/p2pRuntime/worker/applyNodeGlobalsShim";
import { isRootWorker } from "@platform/rootWorkerRuntime";
import { Buffer } from "buffer";

// createRoot loads this before domain dependencies, including in scripted workers.
// Inline imports leave the caller's globals unchanged.
function initializeRootWorkerGlobals(): void {
    applyNodeGlobalsShim(globalThis);
    const scope = globalThis as unknown as {
        Buffer?: typeof Buffer;
        global?: unknown;
    };
    scope.Buffer ||= Buffer;
    scope.global ||= globalThis;
    // Do not invent window: networking uses it to detect browser execution.
}

if (isRootWorker()) initializeRootWorkerGlobals();
