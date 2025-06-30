export class Wasm {
    private readonly instance: WebAssembly.Instance;

    private constructor(instance: WebAssembly.Instance) {
        this.instance = instance;
    }

    static async init(wasmBytes: Uint8Array): Promise<Wasm> {
        const mod = await WebAssembly.compile(wasmBytes);
        const instance = await WebAssembly.instantiate(mod);
        return new Wasm(instance);
    }

    getExport<T extends Function>(name: string): T {
        const exportedFunc = this.instance.exports[name];
        if (typeof exportedFunc !== "function") {
            throw new Error(`Export '${name}' not found or not a function`);
        }
        return exportedFunc as T;
    }

    hasExport(name: string): boolean {
        return this.instance.exports[name] !== undefined;
    }

    getExports(): string[] {
        return Object.keys(this.instance.exports);
    }
}
