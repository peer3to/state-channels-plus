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

            return await this.init(wasmBytes);
        } catch (err) {
            throw new Error(`Failed to load WASM module: ${err}`);
        }
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
