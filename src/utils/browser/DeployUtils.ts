import type { ContractFactory } from "ethers";

type ReturnTypeOfT<T extends ContractFactory> = T extends {
    deploy(...args: any): infer U;
}
    ? U
    : never;

export class DeployUtils {
    constructor(_filePath?: string) {}

    async deployAsync<T extends ContractFactory>(
        _contractFactory: T,
        _contractName: string,
        _args: any[] = []
    ): Promise<ReturnTypeOfT<T>> {
        throw new Error("DeployUtils is only available in Node.js");
    }
}
