import { EVM, createEVM } from "@ethereumjs/evm";
import { Hardfork, Common, Mainnet } from "@ethereumjs/common";
import { createAddPrecompile, createMathPrecompile } from "./precompiles";

export class CustomEVM extends EVM {
    static async create(): Promise<CustomEVM> {
        const common = new Common({
            chain: Mainnet,
            hardfork: Hardfork.Prague
        });

        const mathPrecompile = await createMathPrecompile();
        const addPrecompile = await createAddPrecompile();

        const evm = await createEVM({
            common,
            customPrecompiles: [mathPrecompile, addPrecompile]
        });

        return evm as CustomEVM;
    }
}
