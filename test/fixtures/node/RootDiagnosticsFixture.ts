// @spec-test-coverage-ignore: exercises real root handles and logging through the mapped RuntimeLifecycle cases
import { withRuntimeRpc } from "../RpcRouterFixture";
import { RuntimeRpcControl } from "../runtimeRpc/RuntimeRpcControl";
import { catchWasmTrap } from "../WasmTestModules";
import { deserializeError, serializeError } from "@/rpc/internal/errorWire";
import { LogStore } from "@/utils/logging/logStore";
import { expect } from "chai";

export async function assertRootDiagnostics(fail: boolean): Promise<void> {
    await withRuntimeRpc(async (sdk) => {
        const store = Reflect.get(
            sdk.clientRoot.rootLogger,
            "logStore"
        ) as LogStore;
        store.clearLogs();
        const control = RuntimeRpcControl.attach(sdk.parentTransport);
        const held = control.holdNextResponse("sum");
        const pending = sdk.remote.runtimeProbe
            .sum(5, 6)
            .request()
            .catch((error: Error) => error);
        try {
            await held;
            const secondHeld = control.holdNextResponse("sum");
            const second = sdk.remote.runtimeProbe
                .sum(7, 8)
                .request()
                .catch((error: Error) => error);
            await secondHeld;
            const requestIds = control.sent
                .filter((frame) => frame.method === "sum")
                .map((frame) => frame.requestId);
            expect(requestIds).to.have.length(2);
            expect(new Set(requestIds).size).to.equal(2);
            expect(requestIds.every((id) => id !== undefined)).to.equal(true);
            if (fail) {
                const child = sdk.clientRoot.p2pRuntimeHostRemoteRoot!;
                const observed: Error[] = [];
                child.onError((error) => observed.push(error));
                sdk.clientRoot.errors.failChild(
                    sdk.parentTransport,
                    new Error("Root diagnostic failure")
                );
                expect((await pending) instanceof Error).to.equal(true);
                expect((await second) instanceof Error).to.equal(true);
                expect(observed.map((error) => error.message)).to.deep.equal([
                    "Root diagnostic failure"
                ]);
                const failures = store
                    .getAllLogs()
                    .filter(
                        (entry) =>
                            entry.message ===
                            "Worker failed with pending requests"
                    );
                expect(failures).to.have.length(1);
                expect(
                    failures[0].meta[0].pendingRequests.map(
                        (request: { requestId: string }) => request.requestId
                    )
                ).to.deep.equal(requestIds);
                expect(JSON.stringify(failures[0]))
                    .to.include("runtimeProbe")
                    .and.include("sum");
                expect(JSON.stringify(failures[0])).not.to.include(
                    "calldataBytes"
                );
                sdk.clientRoot.errors.failChild(
                    sdk.parentTransport,
                    new Error("Late failure")
                );
                expect(
                    store
                        .getAllLogs()
                        .filter(
                            (entry) =>
                                entry.message ===
                                "Worker failed with pending requests"
                        )
                ).to.have.length(1);
            } else {
                // Duration is the diagnostic input: hold beyond its one-second threshold.
                await new Promise((resolve) => setTimeout(resolve, 1_050));
                control.release();
                expect(await pending).to.equal(11);
                expect(await second).to.equal(15);
                const slow = store
                    .getAllLogs()
                    .filter(
                        (entry) =>
                            entry.message === "Slow worker request completed"
                    );
                expect(slow).to.have.length(2);
                expect(
                    slow.map((entry) => entry.meta[0].requestId)
                ).to.deep.equal(requestIds);
                expect(JSON.stringify(slow[0]))
                    .to.include("runtimeProbe")
                    .and.include("sum");
                expect(JSON.stringify(slow[0])).not.to.include("calldataBytes");
            }
        } finally {
            control.release();
        }
    });
}

/**
 * A child failure with a request pending, logged by its owner: an ordinary
 * error and a WebAssembly trap restored from the wire, as one that crossed a
 * worker hop arrives. Returns the logged metadata.
 */
async function logChildFailure(error: Error): Promise<Record<string, unknown>> {
    let meta: Record<string, unknown> | undefined;
    await withRuntimeRpc(async (sdk) => {
        const store = Reflect.get(
            sdk.clientRoot.rootLogger,
            "logStore"
        ) as LogStore;
        store.clearLogs();
        const control = RuntimeRpcControl.attach(sdk.parentTransport);
        const held = control.holdNextResponse("sum");
        const pending = sdk.remote.runtimeProbe
            .sum(5, 6)
            .request()
            .catch((failure: Error) => failure);
        try {
            await held;
            const observed: Error[] = [];
            sdk.clientRoot.p2pRuntimeHostRemoteRoot!.onError((failure) =>
                observed.push(failure)
            );
            sdk.clientRoot.errors.failChild(sdk.parentTransport, error);
            expect((await pending) instanceof Error).to.equal(true);
            expect(observed).to.deep.equal([error]);
            const failures = store
                .getAllLogs()
                .filter(
                    (entry) =>
                        entry.message === "Worker failed with pending requests"
                );
            expect(failures).to.have.length(1);
            meta = failures[0].meta[0];
        } finally {
            control.release();
        }
    });
    return meta!;
}

export async function assertChildFailureWasmDiagnostics(): Promise<void> {
    const ordinary = await logChildFailure(new Error("Ordinary child failure"));
    expect(ordinary.wasm).to.equal(undefined);
    expect(ordinary.resources)
        .to.have.property("wasmInstancesCreated")
        .that.is.a("number");

    const trap = await catchWasmTrap();
    const serialized = serializeError(trap);
    const failedWorkerDiagnostics = serialized.wasmDiagnostics;
    expect(failedWorkerDiagnostics).to.not.equal(undefined);
    const wasm = await logChildFailure(deserializeError(serialized));
    expect(wasm.wasm).to.deep.equal(failedWorkerDiagnostics);
    expect(wasm.wasm)
        .to.have.nested.property("probe.canCreate")
        .that.equals(true);
    expect(wasm.wasm).to.have.nested.property("resources.wasmInstancesCreated");
    expect(wasm.resources)
        .to.have.property("wasmInstancesCreated")
        .that.is.a("number");
}
