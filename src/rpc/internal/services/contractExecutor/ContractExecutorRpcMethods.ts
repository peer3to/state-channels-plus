import type { ContractExecutorService } from "./ContractExecutorService";
import { AInternalRpcMethods } from "@/rpc/internal/AInternalRpcMethods";

export class ContractExecutorRpcMethods extends AInternalRpcMethods<ContractExecutorService> {
    public deploy(encodedData: string) {
        return this.service.getExecutor().deploy(encodedData);
    }
    public executeCall(encodedData: string, contractAddress: string) {
        return this.service
            .getExecutor()
            .executeCall(encodedData, contractAddress);
    }
    public simulateCall(encodedData: string, contractAddress: string) {
        return this.service
            .getExecutor()
            .simulateCall(encodedData, contractAddress);
    }
}
