// @spec-test-coverage-ignore: real SDK error-routing staging; executable evidence is mapped from test/rpc/RootErrorService.test.ts
import { withRuntimeRpc } from "./RpcRouterFixture";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

export async function assertRootErrorForwarding(
    inline: boolean
): Promise<void> {
    await withRuntimeRpc(async (sdk) => {
        const reports: Error[] = [];
        const remove = sdk.instance.onHostError((error) => reports.push(error));
        try {
            await sdk.remote.runtimeProbe
                .childReportError("child report")
                .request();
            await waitFor(() => reports.length === 1);
            expect(reports[0].message).to.equal("child report");
            expect(
                await sdk.remote.runtimeProbe.childEcho(7).request()
            ).to.equal(7);
            expect(await sdk.remote.runtimeProbe.sum(3, 4).request()).to.equal(
                7
            );
            expect(reports.length).to.equal(1);
            expect(sdk.clientRoot.router.pendingRequestCount).to.equal(0);
        } finally {
            remove();
        }
    }, inline);
}

export async function assertRequestErrorNotReported(
    inline: boolean
): Promise<void> {
    await withRuntimeRpc(async (sdk) => {
        const reports: Error[] = [];
        const remove = sdk.instance.onHostError((error) => reports.push(error));
        try {
            let failure: unknown;
            try {
                await sdk.remote.runtimeProbe
                    .childFail(true, "request failure")
                    .request();
            } catch (error) {
                failure = error;
            }
            expect((failure as Error).message).to.equal("request failure");
            expect(
                await sdk.remote.runtimeProbe.childEcho(8).request()
            ).to.equal(8);
            expect(reports.length).to.equal(0);
        } finally {
            remove();
        }
    }, inline);
}

export async function assertErrorDirection(): Promise<void> {
    await withRuntimeRpc(async (sdk) => {
        let failure: unknown;
        try {
            await sdk.remote.errors
                .report({ name: "Error", message: "wrong direction" })
                .request();
        } catch (error) {
            failure = error;
        }
        expect((failure as Error).message).to.equal(
            "Root errors must arrive from a child connection"
        );
        expect(await sdk.remote.runtimeProbe.sum(4, 5).request()).to.equal(9);
    });
}

export async function assertNotificationErrorReported(): Promise<void> {
    await withRuntimeRpc(async (sdk) => {
        const reports: Error[] = [];
        const remove = sdk.instance.onHostError((error) => reports.push(error));
        try {
            sdk.remote.runtimeProbe.failAsync("notification failure").send();
            await waitFor(() => reports.length === 1);
            expect(reports[0].message).to.equal("notification failure");
            expect(await sdk.remote.runtimeProbe.sum(2, 3).request()).to.equal(
                5
            );
            expect(reports).to.have.length(1);
        } finally {
            remove();
        }
    });
}

export async function assertHostRpcSelectors(): Promise<void> {
    await withRuntimeRpc(async (sdk) => {
        await expect(
            sdk.remote.hostRpc
                .invoke("missing", "sum", [], "request", [])
                .request()
        ).to.be.rejectedWith("Unknown network RPC service 'missing'");
        await expect(
            sdk.remote.hostRpc
                .invoke(
                    "lobbyMatchingService",
                    "advertise",
                    [],
                    "constructor",
                    []
                )
                .request()
        ).to.be.rejectedWith("Unknown network RPC delivery 'constructor'");
        expect(await sdk.remote.runtimeProbe.sum(2, 3).request()).to.equal(5);
    });
}
