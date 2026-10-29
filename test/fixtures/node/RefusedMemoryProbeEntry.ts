// @spec-test-coverage-ignore: a fresh thread whose WebAssembly memories refuse to grow, loaded before the SDK counter captures the constructor
import { catchWasmTrap } from "../WasmTestModules";
import { REFUSED_GROW_MESSAGE } from "./RefusedMemoryProbeFixture";
import { parentPort } from "node:worker_threads";

let memoriesConstructed = 0;

class RefusedGrowMemory extends WebAssembly.Memory {
    constructor(descriptor: WebAssembly.MemoryDescriptor) {
        super(descriptor);
        memoriesConstructed++;
    }

    override grow(): number {
        throw new RangeError(REFUSED_GROW_MESSAGE);
    }
}

async function run(): Promise<void> {
    WebAssembly.Memory = RefusedGrowMemory;
    // threadResources captures `WebAssembly.Memory` at its first import, so
    // it loads only after the patch.
    const { serializeError } = await import("@/rpc/internal/errorWire");
    const first = serializeError(await catchWasmTrap()).wasmDiagnostics;
    const second = serializeError(await catchWasmTrap()).wasmDiagnostics;
    parentPort!.postMessage({
        firstProbe: first?.probe,
        secondProbe: second?.probe,
        isSameProbe: first !== undefined && first.probe === second?.probe,
        memoriesConstructed
    });
}

void run();
