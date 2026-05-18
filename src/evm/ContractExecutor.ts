import { EVM, ExecResult } from "@ethereumjs/evm";
import { Address } from "@ethereumjs/util";
import { ethers } from "ethers";
import { Bytes } from "@/types/types";
import Clock from "@/Clock";
import { Logger } from "..";
import { Mutex, tryDecodeCustomError } from "@/utils";

export default class ContractExecutor {
    private readonly evm: EVM;
    private readonly contractAddress: Address;
    private readonly logger?: Logger;
    private readonly mutex: Mutex;
    private simulationBaseEvm: EVM;

    constructor(evm: EVM, contractAddress: Address, logger?: Logger) {
        this.evm = evm;
        this.contractAddress = contractAddress;
        this.logger = logger?.child({ component: "ContractExecutor" });
        this.mutex = new Mutex(
            this.logger?.child({ component: "ContractExecutor:Mutex" })
        );
        this.simulationBaseEvm = evm.shallowCopy();
    }

    getContractAddress(): Address {
        return this.contractAddress;
    }

    async executeCall(data: Bytes, caller?: Address): Promise<ExecResult> {
        await this.mutex.lock({ taskName: "executeCall" });

        try {
            return await this.executeCallOn(this.evm, data, caller);
        } finally {
            this.simulationBaseEvm = this.evm.shallowCopy();
            this.mutex.unlock();
        }
    }

    async simulateCall(data: Bytes, caller?: Address): Promise<ExecResult> {
        const evm = this.simulationBaseEvm.shallowCopy();
        await evm.journal.checkpoint();
        try {
            return await this.executeCallOn(evm, data, caller);
        } finally {
            await evm.journal.revert();
        }
    }

    private async executeCallOn(
        evm: EVM,
        data: Bytes,
        caller?: Address
    ): Promise<ExecResult> {
        const result = await evm.runCall({
            data: ethers.getBytes(data),
            to: this.contractAddress,
            block: this.getBlock(),
            caller
        });

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

    private getBlock() {
        const zeroAddress = Address.zero();
        return {
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
    }
}
