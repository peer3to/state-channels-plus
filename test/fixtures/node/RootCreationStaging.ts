import { RootWorkerControl } from "./RootWorkerControl";
// @spec-test-coverage-ignore: real SDK root-creation staging; executable evidence is mapped from test/rpc/RootCreation.test.ts
import { watchdogWorkerRuntime } from "./WorkerExecutorStaging";
import { withRuntimeRpc } from "../RpcRouterFixture";
import { createRoot } from "@/rpc/internal/createRoot";
import { ContractExecutorRoot } from "@/rpc/internal/roots/ContractExecutorRoot";
import { P2pRuntimeHostRoot } from "@/rpc/internal/roots/P2pRuntimeHostRoot";
import { config } from "@/utils/config";
import { rootWorkerUrl } from "@platform/rootWorkerRuntime";
import { expect } from "chai";

export async function assertRootStartupFailureRecovery() {
    await withRuntimeRpc(async (sdk) => {
        const parent = [...sdk.roots].find(
            (root): root is P2pRuntimeHostRoot =>
                root instanceof P2pRuntimeHostRoot
        );
        if (!parent) throw new Error("Expected SDK host root");
        const before = parent.connections.size;
        const { workerUrl, workerData } = watchdogWorkerRuntime("prefunnel");
        let failure: unknown;
        try {
            await RootWorkerControl.run("vm", { workerUrl, workerData }, () =>
                createRoot(ContractExecutorRoot, {
                    parent,
                    workerUrl: rootWorkerUrl(
                        "../worker/ContractExecutorRootEntry.js"
                    ),
                    mode: "worker",
                    args: { config, customPrecompiles: [] }
                })
            );
        } catch (error) {
            failure = error;
        }
        expect((failure as Error).message).to.equal(
            "Stubbed pre-funnel worker failure"
        );
        expect(parent.connections.size).to.equal(before);
        expect(await sdk.remote.runtimeProbe.sum(2, 3).request()).to.equal(5);
        const replacement = await createRoot(ContractExecutorRoot, {
            parent,
            mode: "worker",
            workerUrl: rootWorkerUrl("../worker/ContractExecutorRootEntry.js"),
            args: { config, customPrecompiles: [] }
        });
        try {
            await replacement.awaitReady();
        } finally {
            await replacement.dispose();
        }
        expect(parent.connections.size).to.equal(before);
    });
}

export async function assertExitDuringDisposal(): Promise<void> {
    await withRuntimeRpc(async (sdk) => {
        const parent = [...sdk.roots].find(
            (root): root is P2pRuntimeHostRoot =>
                root instanceof P2pRuntimeHostRoot
        );
        if (!parent) throw new Error("Expected SDK host root");
        const before = parent.children.size;
        const child = await createRoot(ContractExecutorRoot, {
            parent,
            mode: "worker",
            workerUrl: require.resolve("./ExitDuringRootDisposalEntry"),
            args: { config, customPrecompiles: [] }
        });
        await expect(child.dispose()).to.be.rejectedWith(
            "Root worker exited with 23"
        );
        expect(child.isClosed).to.equal(true);
        expect(parent.children.size).to.equal(before);
        await expect(child.dispose()).to.be.rejectedWith(
            "Root worker exited with 23"
        );
        expect(await sdk.remote.runtimeProbe.sum(2, 3).request()).to.equal(5);
    });
}
