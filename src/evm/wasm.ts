import fs from "fs";
import path from "path";

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

    static async load(wasmPathOrUrl: string): Promise<Wasm> {
        try {
            let wasmBytes: Uint8Array;

            if (typeof window !== "undefined") {
                const response = await fetch(wasmPathOrUrl);
                if (!response.ok) {
                    throw new Error(
                        `Failed to fetch WASM file: ${response.statusText}`
                    );
                }
                const buffer = await response.arrayBuffer();
                wasmBytes = new Uint8Array(buffer);
            } else {
                const resolvedPath = path.resolve(wasmPathOrUrl);
                wasmBytes = fs.readFileSync(resolvedPath);
            }

            return this.init(wasmBytes);
        } catch (err) {
            throw new Error(`Failed to load WASM module: ${err}`);
        }
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
