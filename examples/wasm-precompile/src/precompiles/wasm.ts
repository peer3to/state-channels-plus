export class Wasm {
    private instance: WebAssembly.Instance;
    public memory: WebAssembly.Memory;

    private constructor(instance: WebAssembly.Instance) {
        this.instance = instance;
        this.memory = instance.exports.memory as WebAssembly.Memory;
    }

    public static async fromBase64(base64: string): Promise<Wasm> {
        // Decode base64 to binary
        const binary = Buffer.from(base64, "base64");

        // Compile and instantiate the WASM module
        const module = await WebAssembly.compile(binary);
        const instance = await WebAssembly.instantiate(module, {
            env: {
                memory: new WebAssembly.Memory({ initial: 256 }) // 16MB initial memory
            }
        });

        return new Wasm(instance);
    }

    public getExport<T extends Function>(name: string): T {
        const exp = this.instance.exports[name];
        if (!exp) {
            throw new Error(`Export '${name}' not found`);
        }
        return exp as unknown as T;
    }

    public hasExport(name: string): boolean {
        return name in this.instance.exports;
    }

    public get exports(): WebAssembly.Exports {
        return this.instance.exports;
    }
}
