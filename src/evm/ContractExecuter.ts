import { EVM, ExecResult } from "@ethereumjs/evm";
import { Address } from "@ethereumjs/util";
import { ethers } from "ethers";
import { Bytes } from "@/types/types";
import Clock from "@/Clock";
import { Logger } from "..";
import { tryDecodeCustomError } from "@/utils";

export default class ContractExecuter {
    private readonly evm: EVM;
    private readonly contractAddress: Address;
    private readonly logger?: Logger;

    constructor(evm: EVM, contractAddress: Address, logger?: Logger) {
        this.evm = evm;
        this.contractAddress = contractAddress;
        this.logger = logger?.child({ component: "ContractExecuter" });
    }

    getContractAddress(): Address {
        return this.contractAddress;
    }

    async executeCall(
        data: Bytes,
        caller?: Address,
        isSimulation = false
    ): Promise<ExecResult> {
        // set timestamp
        const zeroAddress = Address.zero();
        const block = {
            header: {
                number: 0n,
                cliqueSigner: () => zeroAddress,
                coinbase: zeroAddress,
                timestamp: BigInt(Clock.getTimeInSeconds()),
                difficulty: 0n,
                prevRandao: new Uint8Array(32),
                gasLimit: 30_000_000n,
                baseFeePerGas: 0n,
                getBlobGasPrice: () => undefined
            }
        } as any;

        if (isSimulation) await this.evm.journal.checkpoint();
        const result = await this.evm.runCall({
            data: ethers.getBytes(data),
            to: this.contractAddress,
            block,
            caller
        });
        if (isSimulation) {
            try {
                await this.evm.journal.revert();
            } catch (error) {
                this.logger?.error(
                    "Error EVM journal revert failed after simulation",
                    { error }
                );
            }
        }
        if (result.execResult.exceptionError) {
            const exceptionError = result.execResult.exceptionError;
            const errorData = result.execResult.returnValue
                ? ethers.hexlify(result.execResult.returnValue)
                : null;
            const custom = tryDecodeCustomError({ data: errorData });
            const errorMessage = `EVM execution failed: ${custom?.name || exceptionError.error || exceptionError}`;

            // Create error with structured data for the proxy to handle
            const error = new Error(errorMessage);
            (error as any).data = errorData;

            this.logger?.warn("Contract call execution failed", {
                errors: error,
                custom: custom
            });
            throw error;
        }

        return result.execResult;
    }
}
