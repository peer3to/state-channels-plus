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
const nativeInstantiateStreaming = WebAssembly.instantiateStreaming;
WebAssembly.instantiateStreaming = async (...args) => {
    const result = await nativeInstantiateStreaming(...args);
    seeInstance(result.instance);
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
        // Sources under the gate's browser aliases: the gate never builds dist.
        // The relay module is the control: the index reaches the relay through it.
        const exports =
            entry === "relay"
                ? await import("../../src/HolepunchRelay.ts")
                : await import("../../src/internalRoot.ts");
        self.postMessage({
            instances: instanceCount,
            memories: memoryCount,
            startRootWorker: typeof exports.startRootWorker
        });
    } catch (error) {
        self.postMessage({ error: String(error?.stack ?? error) });
    }
};
