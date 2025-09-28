import { EVM, ExecResult } from "@ethereumjs/evm";
import { Address } from "@ethereumjs/util";
import { ethers } from "ethers";
import { Bytes } from "@/types/types";
import { decodeErrorProxy } from "@/utils/evmErrorHandler";
import { defaultBlock } from "node_modules/@ethereumjs/evm/dist/esm/evm";
import Clock from "@/Clock";

export default class ContractExecuter {
    private readonly evm: EVM;
    private readonly contractAddress: Address;

    constructor(evm: EVM, contractAddress: Address) {
        this.evm = evm;
        this.contractAddress = contractAddress;

        return decodeErrorProxy(this);
    }

    getContractAddress(): Address {
        return this.contractAddress;
    }

    async executeCall(
        data: Bytes,
        caller?: Address,
        isStatic = false
    ): Promise<ExecResult> {
        // set timestamp
        let block = defaultBlock();
        block.header.timestamp = BigInt(Clock.getTimeInSeconds());

        const result = await this.evm.runCall({
            data: ethers.getBytes(data),
            to: this.contractAddress,
            block,
            isStatic
        });

        if (result.execResult.exceptionError) {
            const exceptionError = result.execResult.exceptionError;
            const errorData = result.execResult.returnValue
                ? ethers.hexlify(result.execResult.returnValue)
                : null;

            const errorMessage = `EVM execution failed: ${exceptionError.error || exceptionError}`;

            // Create error with structured data for the proxy to handle
            const error = new Error(errorMessage);
            (error as any).execResult = result.execResult;
            (error as any).data = errorData;

            throw error;
        }

        return result.execResult;
    }
}
