// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import type { EvmCustomPrecompileFactory } from "@/evm/EvmFactory";
import { AbiCoder, getBytes } from "ethers";

const createRuntimeValuePrecompile: EvmCustomPrecompileFactory<{
    value: bigint;
    bytes: Uint8Array;
}> = async (options) => {
    await Promise.resolve();
    return () => ({
        executionGasUsed: 0n,
        returnValue: getBytes(
            AbiCoder.defaultAbiCoder().encode(
                ["uint256", "bool", "bytes"],
                [
                    options?.value ?? 0n,
                    false,
                    options?.bytes ?? new Uint8Array()
                ]
            )
        )
    });
};

export default createRuntimeValuePrecompile;
