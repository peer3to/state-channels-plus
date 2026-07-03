// Minimal Node-global shims for the browser host worker. The EVM stack
// (@ethereumjs/evm and its bundled stream/debug deps) reads `process`
// (process.env.DEBUG, process.nextTick) and `global`, neither of which exists
// in a Web Worker. The worker entry imports this first so the globals are in
// place before the host boots the EVM. Each field is patched independently
// with `??=`, so a bundler's partial `process` shim (e.g. `{ env }` with no
// `nextTick`) gets the missing pieces filled in rather than left undefined. On
// Node the fields already exist, so the assignments no-op and this stays inert.

type NodeGlobalScope = {
    global?: unknown;
    process?: unknown;
};

export function applyNodeGlobalsShim(scope: NodeGlobalScope): void {
    scope.global ??= globalThis;

    if (typeof scope.process !== "object" || scope.process === null) {
        scope.process = {};
    }
    const processShim = scope.process as {
        env?: Record<string, string | undefined>;
        nextTick?: (
            callback: (...args: unknown[]) => void,
            ...args: unknown[]
        ) => void;
        browser?: boolean;
    };
    processShim.env ??= {};
    processShim.nextTick ??= (
        callback: (...args: unknown[]) => void,
        ...args: unknown[]
    ) => queueMicrotask(() => callback(...args));
    processShim.browser ??= true;
}

applyNodeGlobalsShim(globalThis as unknown as NodeGlobalScope);
