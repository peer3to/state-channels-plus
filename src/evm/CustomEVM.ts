import { EVM, createEVM } from "@ethereumjs/evm";
import { Hardfork, Common, Mainnet } from "@ethereumjs/common";
import { createAddPrecompile, initAddWasm } from "./examples/add-precompile";

export class CustomEVM extends EVM {
    static async create(): Promise<CustomEVM> {
        const common = new Common({
            chain: Mainnet,
            hardfork: Hardfork.Prague
        });

        await initAddWasm();

        const evm = await createEVM({
            common,
            customPrecompiles: [createAddPrecompile()]
        });

        return evm as CustomEVM;
    }
}
