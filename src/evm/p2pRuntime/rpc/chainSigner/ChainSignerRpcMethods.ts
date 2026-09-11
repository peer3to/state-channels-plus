import {
    deserializeSignerMessage,
    deserializeTransactionRequest,
    serializeTransactionResponse,
    type SerializedTransactionRequest,
    type SerializedTransactionResponse,
    type SignerMessage
} from "../../chainSignerSerialization";
import type { P2pRuntimeHostRoot } from "../P2pRuntimeHostRoot";
import ARpcMethods from "@/rpc/ARpcMethods";
import type { RpcRouter } from "@/rpc/RpcRouter";
import { ethers } from "ethers";

export class ChainSignerRpcMethods extends ARpcMethods<
    RpcRouter<P2pRuntimeHostRoot, any>
> {
    signTransaction(
        serializedTransaction: SerializedTransactionRequest
    ): Promise<string> {
        return this.localRpc.host.chainSigner.signTransaction(
            deserializeTransactionRequest(serializedTransaction)
        );
    }

    async sendTransaction(
        serializedTransaction: SerializedTransactionRequest
    ): Promise<SerializedTransactionResponse> {
        const response = await this.localRpc.host.chainSigner.sendTransaction(
            deserializeTransactionRequest(serializedTransaction)
        );
        return serializeTransactionResponse(response);
    }

    signMessage(message: SignerMessage): Promise<string> {
        return this.localRpc.host.chainSigner.signMessage(
            deserializeSignerMessage(message)
        );
    }

    signTypedData(
        domain: ethers.TypedDataDomain,
        types: Record<string, ethers.TypedDataField[]>,
        value: Record<string, any>
    ): Promise<string> {
        return this.localRpc.host.chainSigner.signTypedData(
            domain,
            types,
            value
        );
    }
}

export default ChainSignerRpcMethods;
