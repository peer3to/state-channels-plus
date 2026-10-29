import type { DeploySignerService } from "./DeploySignerService";
import {
    deserializeTransactionRequest,
    type SerializedTransactionRequest
} from "../chainSigner/chainSignerSerialization";
import { AInternalRpcMethods } from "@/rpc/internal/AInternalRpcMethods";

export class DeploySignerRpcMethods extends AInternalRpcMethods<DeploySignerService> {
    public async getAddress() {
        return await this.service.deploySigner.getAddress();
    }

    public async getNonce() {
        return await this.service.deploySigner.getNonce();
    }

    public async resolveName(name: string) {
        return await this.service.deploySigner.resolveName(name);
    }

    public async call(tx: SerializedTransactionRequest) {
        const encodedReturnData = await this.service.deploySigner.call(
            deserializeTransactionRequest(tx)
        );
        return { encodedReturnData };
    }

    public async sendTransaction(tx: SerializedTransactionRequest) {
        const deployTx = await this.service.deploySigner.sendTransaction(
            deserializeTransactionRequest(tx)
        );
        const receipt = await deployTx.wait();
        return {
            hash: deployTx.hash,
            to: deployTx.to,
            from: deployTx.from,
            data: deployTx.data,
            receipt: receipt && {
                status: receipt.status,
                logs: [],
                contractAddress: receipt.contractAddress,
                to: receipt.to,
                gasUsed: receipt.gasUsed.toString()
            }
        };
    }
}
