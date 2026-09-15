// @spec-test-coverage-ignore: real roots and ports for error boundary assertions
import { AInternalRpcRoot } from "@/rpc/internal/AInternalRpcRoot";
import { createRuntimeChannel } from "@platform/p2pRuntimeChannel";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

class BoundaryRoot extends AInternalRpcRoot {
    public async start(): Promise<void> {}
    public dispose(): Promise<void> {
        return this.disposeRoot(() => {});
    }
}

export async function assertEarlyRootError(startup: boolean): Promise<void> {
    const reports: unknown[] = [];
    const parent = new BoundaryRoot((error) => reports.push(error));
    const child = new BoundaryRoot((error) => reports.push(error));
    const channel = createRuntimeChannel();
    const remoteRoot = parent.connect(channel.port1, {
        remoteRelation: "child",
        sameRealm: true
    });
    const parentRemoteRoot = child.connect(channel.port2, {
        remoteRelation: "parent",
        sameRealm: true
    });
    const waiting = remoteRoot.awaitReady().catch((error: Error) => error);
    const error = { name: "Error", message: "failure before readiness" };
    try {
        if (startup) parentRemoteRoot.rpc.errors.startupFailed(error).send();
        else parentRemoteRoot.rpc.errors.report(error).send();
        expect(((await waiting) as Error).message).to.equal(error.message);
        await waitFor(() => remoteRoot.isClosed);
        expect(reports).to.have.length(0);
    } finally {
        child.closeConnections();
        await child.dispose();
        await parent.dispose();
    }
}
