import type { Address, Bytes } from "@/types/types";

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
}

export default AContractExecutor;
