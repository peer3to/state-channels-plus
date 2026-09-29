// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import type { EvmCustomPrecompileFactory } from "@/evm/EvmFactory";
import type {
    AInternalRpcRoot,
    RuntimeConnection
} from "@/rpc/internal/AInternalRpcRoot";
import { createRoot } from "@/rpc/internal/createRoot";
import type { RemoteRoot } from "@/rpc/internal/RemoteRoot";
import { ContractExecutorRoot } from "@/rpc/internal/roots/ContractExecutorRoot";
import { config } from "@/utils/config";
import type { RuntimeProbeRoot } from "@test/fixtures/runtimeRpc/probe/runtime/RuntimeProbeService";
import { AbiCoder, getBytes } from "ethers";
import path from "node:path";

export type RuntimeValueChild = {
    owner: AInternalRpcRoot;
    child: RemoteRoot<ContractExecutorRoot>;
    calls: number;
};

/**
 * Live children created by this precompile in the current realm, in creation
 * order. They never cross a port; a test in the same realm reads them.
 */
export const runtimeValueChildren: RuntimeValueChild[] = [];

const createRuntimeValuePrecompile: EvmCustomPrecompileFactory<{
    value: bigint;
    bytes: Uint8Array;
}> = async (options, context) => {
    const owner = context.owner;
    if (!(owner instanceof ContractExecutorRoot))
        throw new Error("Expected the executor root as the precompile owner");
    // A real SDK probe child under the supplied owner. It loads no custom
    // precompiles, so it never loads this manifest recursively.
    const child = await createRoot(ContractExecutorRoot, {
        parent: owner,
        mode: "worker",
        workerUrl: path.join(__dirname, "RuntimeRpcExecutorEntry.ts"),
        args: { config, customPrecompiles: [] }
    });
    if (!owner.children.has(child))
        throw new Error("Precompile child is not attached to its owner");
    const record: RuntimeValueChild = { owner, child, calls: 0 };
    runtimeValueChildren.push(record);
    // The probe endpoints are installed by the worker entry, not the class.
    const probe = (
        child.rpc as RuntimeConnection<ContractExecutorRoot & RuntimeProbeRoot>
    ).runtimeProbe;
    return async () => {
        record.calls += 1;
        const bytes = (await probe
            .echo(options?.bytes ?? new Uint8Array())
            .request()) as Uint8Array;
        return {
            executionGasUsed: 0n,
            returnValue: getBytes(
                AbiCoder.defaultAbiCoder().encode(
                    ["uint256", "bool", "bytes"],
                    [options?.value ?? 0n, false, bytes]
                )
            )
        };
    };
};

export default createRuntimeValuePrecompile;
