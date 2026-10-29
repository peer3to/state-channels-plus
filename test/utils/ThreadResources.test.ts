import { deserializeError, serializeError } from "@/rpc/internal/errorWire";
import {
    getThreadResources,
    trackWorker,
    type WasmFailureDiagnostics
} from "@/utils/threadResources";
import { assertRefusedGrowProbeIsReused } from "@test/fixtures/node/RefusedMemoryProbeFixture";
import { catchWasmTrap, MEMORY_MODULE } from "@test/fixtures/WasmTestModules";
import { expect } from "chai";

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

    it("counts the instance and memory that instantiateStreaming creates from a streamed module", async function () {
        const before = getThreadResources();
        const streamed = await WebAssembly.instantiateStreaming(
            new Response(MEMORY_MODULE, {
                headers: { "content-type": "application/wasm" }
            })
        );
        const after = getThreadResources();

        expect(streamed.instance).to.be.instanceOf(WebAssembly.Instance);
        expect(
            after.wasmInstancesCreated - before.wasmInstancesCreated
        ).to.equal(1);
        expect(after.wasmMemoriesCreated - before.wasmMemoriesCreated).to.equal(
            1
        );
    });

    it("attaches this thread's resources, a working memory probe, and the device to a WebAssembly trap it serializes, and the receiving side keeps them", async function () {
        const trap = await catchWasmTrap();

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

    it("reports a refused 16 MiB grow in the memory probe with its error, and a later WebAssembly failure in the same thread reuses that probe", async function () {
        await assertRefusedGrowProbeIsReused();
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
