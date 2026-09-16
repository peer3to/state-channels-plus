import { childDisposedError } from "@/rpc/internal/RemoteRoot";
import { hasRpcService } from "@/utils/ObjectChecks";
import {
    assertCanonicalSimulationOrder,
    assertExecutorCloneIsolation,
    assertExecutorManifestValues,
    assertExecutorRevertRecovery,
    withSdkStorage
} from "@test/fixtures/node/ContractExecutorRuntimeFixture";
import {
    assertExecutorInitializationOrder,
    assertInlineLoggerOwnership
} from "@test/fixtures/node/ExecutorConstructionFixture";
import { sdkExecutorOwner } from "@test/fixtures/node/SdkExecutorFixture";
import { RuntimeRpcControl } from "@test/fixtures/runtimeRpc/RuntimeRpcControl";
import { expect } from "chai";

describe("ContractExecutorRuntime", () => {
    it("waits for inline initialization and the ready signal before returning", async () => {
        await assertExecutorInitializationOrder(false);
    });
    it("waits for worker initialization and the ready signal before returning", async () => {
        await assertExecutorInitializationOrder(true);
    });
    it("keeps the supplied inline logger and starts no duplicate monitor", async () => {
        await assertInlineLoggerOwnership();
    });
    it("normalizes inline manifest addresses and preserves optional binary and BigInt values", async () => {
        await assertExecutorManifestValues(false);
    });
    it("normalizes worker manifest addresses and preserves optional binary and BigInt values", async () => {
        await assertExecutorManifestValues(true);
    });
    it("installs no probe or controller during ordinary SDK construction", async () => {
        await withSdkStorage(false, async (executor) => {
            const owner = sdkExecutorOwner(executor);
            expect("runtimeProbe" in owner).to.equal(false);
            expect("loggerProbe" in owner).to.equal(false);
            expect(
                Object.keys(owner).filter((key) => hasRpcService(owner, key))
            ).to.have.members([
                "logger",
                "errors",
                "chainSigner",
                "deploySigner",
                "p2pSigner",
                "hostRpc",
                "lifecycle",
                "sdkSetup"
            ]);
            expect(
                [...owner.connections.keys()].every(
                    (transport) =>
                        RuntimeRpcControl.get(transport) === undefined
                )
            ).to.equal(true);
        });
    });
    it("keeps canonical calls and simulations ordered through the inline RPC adapter", async () => {
        await assertCanonicalSimulationOrder(false);
    });
    it("keeps canonical calls and simulations ordered through the worker RPC adapter", async () => {
        await assertCanonicalSimulationOrder(true);
    });
    it("preserves inline revert bytes and serves the next call", async () => {
        await assertExecutorRevertRecovery(false);
    });
    it("preserves worker revert bytes and serves the next call", async () => {
        await assertExecutorRevertRecovery(true);
    });
    it("isolates inline returned results from executor-owned state", async () => {
        await assertExecutorCloneIsolation(false);
    });
    it("isolates worker returned results from executor-owned state", async () => {
        await assertExecutorCloneIsolation(true);
    });
    it("rejects inline calls after repeated executor disposal", async () => {
        await withSdkStorage(
            false,
            async (executor, address, contractInterface) => {
                const owner = sdkExecutorOwner(executor);
                const connections = owner.connections.size;
                await executor.dispose();
                await executor.dispose();
                expect(owner.connections.size).to.equal(connections - 1);
                const result = await executor
                    .executeCall(
                        contractInterface.encodeFunctionData("getValue"),
                        address
                    )
                    .catch((error: Error) => error.message);
                expect(result).to.equal(childDisposedError().message);
            }
        );
    });
    it("rejects worker calls after repeated executor disposal", async () => {
        await withSdkStorage(
            true,
            async (executor, address, contractInterface) => {
                await executor.dispose();
                await executor.dispose();
                const result = await executor
                    .executeCall(
                        contractInterface.encodeFunctionData("getValue"),
                        address
                    )
                    .catch((error: Error) => error.message);
                expect(result).to.equal(childDisposedError().message);
                expect(
                    sdkExecutorOwner(executor).router.pendingRequestCount
                ).to.equal(0);
            }
        );
    });
});
