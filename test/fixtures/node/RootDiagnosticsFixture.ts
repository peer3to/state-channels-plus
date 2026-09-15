// @spec-test-coverage-ignore: exercises real root handles and logging through the mapped RuntimeLifecycle cases
import { withRuntimeRpc } from "../RpcRouterFixture";
import { RuntimeRpcControl } from "../runtimeRpc/RuntimeRpcControl";
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
