import {
    deserializeTransactionRequest,
    serializeTransactionResponse,
    type SerializedTransactionRequest
} from "./chainSignerSerialization";
import type { ChainSignerService } from "./ChainSignerService";
import { AInternalRpcMethods } from "@/rpc/internal/AInternalRpcMethods";
import {
    deserializeSignerMessage,
    type SerializedSignerMessage
} from "@/rpc/internal/services/chainSigner/chainSignerSerialization";
import { ethers } from "ethers";

export class ChainSignerRpcMethods extends AInternalRpcMethods<ChainSignerService> {
    public async signTransaction(
        serializedTransaction: SerializedTransactionRequest
    ) {
        return await this.service.chainSigner.signTransaction(
            deserializeTransactionRequest(serializedTransaction)
        );
    }

    public async sendTransaction(
        serializedTransaction: SerializedTransactionRequest
    ) {
        const response = await this.service.chainSigner.sendTransaction(
            deserializeTransactionRequest(serializedTransaction)
        );
        return serializeTransactionResponse(response);
    }

    /** Aggregated gas of the transactions this peer's chain signer sent. */
    public getGasUsageTable() {
        return { gasUsage: this.service.chainSigner.gasUsage.snapshot() };
    }

    public async signMessage(message: SerializedSignerMessage) {
        return await this.service.chainSigner.signMessage(
            deserializeSignerMessage(message)
        );
    }

    public async signTypedData(
        domain: ethers.TypedDataDomain,
        types: Record<string, ethers.TypedDataField[]>,
        value: Record<string, unknown>
    ) {
        return await this.service.chainSigner.signTypedData(
            domain,
            types,
            value
        );
    }
}
