import type { ContractFactory } from "ethers";

export class DeployUtils {
    constructor(_filePath?: string) {}

    async deployAsync<T extends ContractFactory>(
        _contractFactory: T,
        _contractName: string,
        _args: any[] = []
    ): Promise<ReturnType<T["deploy"]>> {
        throw new Error("DeployUtils is only available in Node.js");
    }
}
