import { EVM, createEVM } from "@ethereumjs/evm";
import { Hardfork, Common, Mainnet } from "@ethereumjs/common";
import { createAddPrecompile } from "./examples/add-precompile";

export class CustomEVM extends EVM {
    static async create(): Promise<CustomEVM> {
        const common = new Common({
            chain: Mainnet,
            hardfork: Hardfork.Prague
        });

        const addPrecompile = await createAddPrecompile();

        const evm = await createEVM({
            common,
            customPrecompiles: [addPrecompile]
        });

        return evm as CustomEVM;
    }
}
