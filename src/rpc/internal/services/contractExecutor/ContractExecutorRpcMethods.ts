import type { ContractExecutorService } from "./ContractExecutorService";
import { AInternalRpcMethods } from "@/rpc/internal/AInternalRpcMethods";

export class ContractExecutorRpcMethods extends AInternalRpcMethods<ContractExecutorService> {
    public deploy(encodedData: string) {
        return this.service.admit((executor) => executor.deploy(encodedData));
    }
    public executeCall(
        encodedData: string,
        contractAddress: string,
        callGasLimit?: string
    ) {
        return this.service.admit((executor) =>
            executor.executeCall(
                encodedData,
                contractAddress,
                callGasLimit !== undefined ? BigInt(callGasLimit) : undefined
            )
        );
    }
    public simulateCall(
        encodedData: string,
        contractAddress: string,
        callGasLimit?: string
    ) {
        return this.service.admit((executor) =>
            executor.simulateCall(
                encodedData,
                contractAddress,
                callGasLimit !== undefined ? BigInt(callGasLimit) : undefined
            )
        );
    }
}
