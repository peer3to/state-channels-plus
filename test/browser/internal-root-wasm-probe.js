// @spec-test-coverage-ignore: browser worker fixture driven by the mapped browser worker gate
import { Buffer } from "buffer";

globalThis.Buffer ||= Buffer;
globalThis.window ||= globalThis;

// Counts every WASM instance and memory this worker creates. Installed before
// the entry is imported, so module-load instantiation is counted too.
const seenMemories = new WeakSet();
let memoryCount = 0;
let instanceCount = 0;
const seeMemory = (value) => {
    if (value instanceof WebAssembly.Memory && !seenMemories.has(value)) {
        seenMemories.add(value);
        memoryCount += 1;
    }
};
const seeInstance = (instance) => {
    instanceCount += 1;
    for (const value of Object.values(instance.exports)) seeMemory(value);
};
const NativeInstance = WebAssembly.Instance;
WebAssembly.Instance = function (module, imports) {
    const instance = new NativeInstance(module, imports);
    seeInstance(instance);
    return instance;
};
WebAssembly.Instance.prototype = NativeInstance.prototype;
const nativeInstantiate = WebAssembly.instantiate;
WebAssembly.instantiate = async (...args) => {
    const result = await nativeInstantiate(...args);
    seeInstance(result.instance ?? result);
    return result;
};
const NativeMemory = WebAssembly.Memory;
WebAssembly.Memory = function (descriptor) {
    const memory = new NativeMemory(descriptor);
    seeMemory(memory);
    return memory;
};
WebAssembly.Memory.prototype = NativeMemory.prototype;

self.onmessage = async ({ data: entry }) => {
    try {
        // The built browser targets the package exports, as a consumer loads them.
        const exports =
            entry === "index"
                ? await import("../../dist/browser/src/index.js")
                : await import("../../dist/browser/src/internalRoot.js");
        self.postMessage({
            instances: instanceCount,
            memories: memoryCount,
            startRootWorker: typeof exports.startRootWorker
        });
    } catch (error) {
        self.postMessage({ error: String(error?.stack ?? error) });
    }
};
