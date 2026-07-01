// Minimal Node-global shims for the browser host worker. The EVM stack
// (@ethereumjs/evm and its bundled stream/debug deps) reads `process`
// (process.env.DEBUG, process.nextTick) and `global`, neither of which exists
// in a Web Worker. The worker entry imports this first so the globals are in
// place before the host boots the EVM. On Node these already exist, so the
// `??=` assignments no-op and this stays inert.
const scope = globalThis as unknown as {
    global?: unknown;
    process?: unknown;
};

scope.global ??= globalThis;

scope.process ??= {
    env: {} as Record<string, string | undefined>,
    nextTick: (callback: (...args: unknown[]) => void, ...args: unknown[]) =>
        queueMicrotask(() => callback(...args)),
    browser: true
};
