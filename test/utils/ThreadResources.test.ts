import { deserializeError, serializeError } from "@/rpc/internal/errorWire";
import {
    getThreadResources,
    trackWorker,
    type WasmFailureDiagnostics
} from "@/utils/threadResources";
import { expect } from "chai";

/** A module that exports one one-page memory. */
const MEMORY_MODULE = new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x05, 0x03, 0x01, 0x00,
    0x01, 0x07, 0x0a, 0x01, 0x06, 0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79, 0x02, 0x00
]);

/** A module that exports `trap`, a function that runs `unreachable`. */
const TRAP_MODULE = new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x04, 0x01, 0x60,
    0x00, 0x00, 0x03, 0x02, 0x01, 0x00, 0x07, 0x08, 0x01, 0x04, 0x74, 0x72,
    0x61, 0x70, 0x00, 0x00, 0x0a, 0x05, 0x01, 0x03, 0x00, 0x00, 0x0b
]);

describe("Thread resources", function () {
    it("counts the instances and memories this thread creates through each WebAssembly entry point, and keeps instanceof working", async function () {
        const before = getThreadResources();
        const constructed = new WebAssembly.Instance(
            new WebAssembly.Module(MEMORY_MODULE)
        );
        const instantiated = await WebAssembly.instantiate(MEMORY_MODULE);
        const memory = new WebAssembly.Memory({ initial: 2 });
        const after = getThreadResources();

        expect(constructed).to.be.instanceOf(WebAssembly.Instance);
        expect(instantiated.instance).to.be.instanceOf(WebAssembly.Instance);
        expect(memory).to.be.instanceOf(WebAssembly.Memory);
        expect(
            after.wasmInstancesCreated - before.wasmInstancesCreated
        ).to.equal(2);
        expect(after.wasmMemoriesCreated - before.wasmMemoriesCreated).to.equal(
            3
        );
        // The two-page memory is still referenced: 128 KiB.
        expect(after.largestWasmMemoryMiB).to.be.at.least(0.1);
    });

    it("attaches this thread's resources, a working memory probe, and the device to a WebAssembly trap it serializes, and the receiving side keeps them", async function () {
        const { instance } = await WebAssembly.instantiate(TRAP_MODULE);
        let trap: unknown;
        try {
            (instance.exports.trap as () => void)();
        } catch (error) {
            trap = error;
        }

        const serialized = serializeError(trap);
        const diagnostics = serialized.wasmDiagnostics;
        expect(diagnostics?.probe).to.deep.equal({
            canCreate: true,
            canGrow16MiB: true
        });
        expect(diagnostics?.resources.wasmInstancesCreated).to.be.at.least(1);
        expect(diagnostics?.environment.userAgent).to.equal(
            globalThis.navigator.userAgent
        );
        const restored = deserializeError(serialized) as Error & {
            wasmDiagnostics?: WasmFailureDiagnostics;
        };
        expect(restored.wasmDiagnostics).to.deep.equal(diagnostics);
        // A later hop keeps the diagnostics taken where the trap happened.
        expect(serializeError(restored).wasmDiagnostics).to.deep.equal(
            diagnostics
        );
    });

    it("attaches no WebAssembly diagnostics to an ordinary error", function () {
        expect(
            serializeError(new Error("ordinary failure")).wasmDiagnostics
        ).to.equal(undefined);
    });

    it("counts a spawned worker until its first shutdown ends, once across repeated shutdowns", async function () {
        const before = getThreadResources().workers;
        const worker = trackWorker({ shutdown: async () => {} });
        expect(getThreadResources().workers).to.equal(before + 1);

        await worker.shutdown();
        await worker.shutdown();
        expect(getThreadResources().workers).to.equal(before);
    });
});
