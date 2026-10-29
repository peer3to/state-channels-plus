declare global {
    var threadName: string;
}

/** Diagnostic name shared by every root in this JavaScript execution context. */
globalThis.threadName ??= "main";

export {};
