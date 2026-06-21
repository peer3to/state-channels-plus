import fs from "fs";
import path from "path";
import { ContractFactory } from "ethers";

export class DeployUtils {
    contractsPath: string;
    contractsJSON: any;

    constructor(filePath?: string) {
        this.contractsPath =
            filePath || path.resolve(__dirname, "../../../contracts.json");
        this.contractsJSON = fs.existsSync(this.contractsPath)
            ? require(this.contractsPath)
            : {};
    }

    /**
     * @param contractFactory - the contract factory used in hardhat for deploying a contract
     */
    async deployAsync<T extends ContractFactory>(
        contractFactory: T,
        contractName: string,
        args: any[] = []
    ): Promise<ReturnType<T["deploy"]>> {
        const contractsJSON = this.contractsJSON;

        const instance = await contractFactory.deploy(...args, {
            gasLimit: 20000000
        });
        contractsJSON[contractName] = {};
        contractsJSON[contractName].address = await instance.getAddress();
        contractsJSON[contractName].abi =
            contractFactory.interface.formatJson();
        fs.writeFileSync(
            this.contractsPath,
            JSON.stringify(contractsJSON, null, 2)
        );
        return instance as ReturnType<T["deploy"]>;
    }
}
