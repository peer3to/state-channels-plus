export class Wasm {
    private static instance: WebAssembly.Instance | undefined;

    static async init(wasmBytes: Uint8Array) {
        if (this.instance) return;
        const mod = await WebAssembly.compile(wasmBytes);
        this.instance = await WebAssembly.instantiate(mod);
    }

    static getExport<T extends Function>(name: string): T {
        if (!this.instance) {
            throw new Error("WASM module not initialized. Call init() first.");
        }
        const exportedFunc = this.instance.exports[name];
        if (typeof exportedFunc !== "function") {
            throw new Error(`Export '${name}' not found or not a function`);
        }
        return exportedFunc as T;
    }

    static hasExport(name: string): boolean {
        return this.instance?.exports[name] !== undefined;
    }
}
