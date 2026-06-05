import type { Address, Bytes } from "@/types/types";
import type { Logger } from "@/utils/logging/Logger";

export type ContractExecutionLog = {
    address: Address;
    topics: string[];
    data: string;
};

export type ContractExecutionResult = {
    returnValue: string; //hexString
    logs?: ContractExecutionLog[];
    createdAddress?: Address;
};

abstract class AContractExecutor {
    abstract deploy(data: Bytes): Promise<ContractExecutionResult>;
    abstract executeCall(
        data: Bytes,
        contractAddress: Address
    ): Promise<ContractExecutionResult>;
    abstract simulateCall(
        data: Bytes,
        contractAddress: Address
    ): Promise<ContractExecutionResult>;

    dispose(): Promise<void> | void {}

    // Wire the SDK logger into a worker executor's gossip node; no-op for the inline one.
    attachLogger(_logger: Logger): void {}
}

export default AContractExecutor;
