export class Wasm {
    private readonly instance: WebAssembly.Instance;

    private constructor(instance: WebAssembly.Instance) {
        this.instance = instance;
    }

    static async fromBytes(bytes: Uint8Array): Promise<Wasm> {
        const module = await WebAssembly.compile(bytes);
        const instance = await WebAssembly.instantiate(module);
        return new Wasm(instance);
    }

    static async fromBase64(base64: string): Promise<Wasm> {
        const binary = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        return this.fromBytes(binary);
    }

    get exports(): WebAssembly.Exports {
        return this.instance.exports;
    }

    getExport<T extends Function>(name: string): T {
        if (!this.hasExport(name)) {
            throw new Error(`Export '${name}' not found`);
        }

        const exportedFunc = this.instance.exports[name];
        if (typeof exportedFunc !== "function") {
            throw new Error(`Export '${name}' is not a function`);
        }
        return exportedFunc as T;
    }

    hasExport(name: string): boolean {
        return this.instance.exports[name] !== undefined;
    }

    get memory(): WebAssembly.Memory {
        const mem = this.instance.exports.memory;
        if (!(mem instanceof WebAssembly.Memory)) {
            throw new Error("WASM module does not export memory");
        }
        return mem;
    }
}
