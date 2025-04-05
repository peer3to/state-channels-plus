import { EVM, EVMResult, ExecResult } from "@ethereumjs/evm";
import { Address } from "@ethereumjs/util";
import { BytesLike, ethers } from "ethers";


export class ContractExecuter {
    private readonly evm: EVM;
    private readonly contractAddress: Address;

    constructor(evm: EVM, contractAddress: Address) {
        this.evm = evm;
        this.contractAddress = contractAddress;
    }


    async executeCall(data: BytesLike): Promise<ExecResult> {
        const result = await this.evm.runCall({
            data: ethers.getBytes(data),
            to: this.contractAddress
        });

        if (result.execResult.exceptionError) {
            throw this.decodeError(result);
        }

        return result.execResult;
    }

 
    private decodeError(result: EVMResult): Error {
        let hex = ethers.hexlify(result.execResult.returnValue);
        hex = "0x" + hex.slice(2 + 8);
        let decodedString = ethers.AbiCoder.defaultAbiCoder().decode(
            ["string"],
            hex
        );
        return new Error(`EVM execution error: ${decodedString}`);
    }
}