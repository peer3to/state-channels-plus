import { EVM, createEVM as createEVMBase } from "@ethereumjs/evm";
import { Hardfork, Common, Mainnet } from "@ethereumjs/common";
import { CustomPrecompile } from "@ethereumjs/evm/dist/cjs/precompiles";

export function createEVM(precompiles: CustomPrecompile[]): Promise<EVM> {
    const common = new Common({
        chain: Mainnet,
        hardfork: Hardfork.Prague
    });

    if (precompiles.length === 0) {
        return createEVMBase();
    }

    return createEVMBase({
        common,
        customPrecompiles: precompiles
    });
}
