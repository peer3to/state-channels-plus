import AContractExecutor, {
    type ContractExecutionResult
} from "./AContractExecutor";
import type { ContractExecutorRemoteRoot } from "@/rpc/internal/roots/ContractExecutorRoot";
import type { Address, Bytes } from "@/types/types";
import { ethers } from "ethers";
export default class RpcContractExecutor extends AContractExecutor {
    constructor(
        private readonly contractExecutorRemoteRoot: ContractExecutorRemoteRoot
    ) {
        super();
    }
    async deploy(data: Bytes): Promise<ContractExecutionResult> {
        return this.contractExecutorRemoteRoot.rpc.executor
            .deploy(ethers.hexlify(data))
            .request({ timeoutMs: null });
    }

    async executeCall(
        data: Bytes,
        contractAddress: Address
    ): Promise<ContractExecutionResult> {
        return this.contractExecutorRemoteRoot.rpc.executor
            .executeCall(ethers.hexlify(data), contractAddress.toString())
            .request({ timeoutMs: null });
    }

    async simulateCall(
        data: Bytes,
        contractAddress: Address
    ): Promise<ContractExecutionResult> {
        return this.contractExecutorRemoteRoot.rpc.executor
            .simulateCall(ethers.hexlify(data), contractAddress.toString())
            .request({ timeoutMs: null });
    }

    // Overrides AContractExecutor.dispose to await the owned remote root.
    override dispose(): Promise<void> {
        return this.contractExecutorRemoteRoot.dispose();
    }
}
