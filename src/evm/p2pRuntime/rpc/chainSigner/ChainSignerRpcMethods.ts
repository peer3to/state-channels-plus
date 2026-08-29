import { ethers } from "ethers";
import ARpcMethods from "@/rpc/ARpcMethods";
import type PortRpcRouter from "@/rpc/PortRpcRouter";
import type ATransport from "@/transport/ATransport";
import {
    deserializeTransactionRequest,
    serializeTransactionResponse,
    type SerializedTransactionRequest,
    type SerializedTransactionResponse
} from "../../chainSignerSerialization";
import type { P2pRuntimeHostRoot } from "../P2pRuntimeHostRoot";
import type { ChainSignerService } from "./ChainSignerService";

/** a message to sign, as it crosses: text, or bytes as hex */
export type ChainSignerMessage =
    | { kind: "string"; value: string }
    | { kind: "bytes"; encodedBytes: string };

export class ChainSignerRpcMethods extends ARpcMethods<
    PortRpcRouter<P2pRuntimeHostRoot>
> {
    constructor(
        transport: ATransport,
        private readonly service: ChainSignerService
    ) {
        super(transport, service.router);
    }

    signTransaction(
        serializedTransaction: SerializedTransactionRequest
    ): Promise<string> {
        return this.service.host.chainSigner.signTransaction(
            deserializeTransactionRequest(serializedTransaction)
        );
    }

    async sendTransaction(
        serializedTransaction: SerializedTransactionRequest
    ): Promise<SerializedTransactionResponse> {
        const response = await this.service.host.chainSigner.sendTransaction(
            deserializeTransactionRequest(serializedTransaction)
        );
        return serializeTransactionResponse(response);
    }

    signMessage(message: ChainSignerMessage): Promise<string> {
        return this.service.host.chainSigner.signMessage(
            message.kind === "string"
                ? message.value
                : ethers.getBytes(message.encodedBytes)
        );
    }

    signTypedData(
        domain: unknown,
        types: unknown,
        value: unknown
    ): Promise<string> {
        return this.service.host.chainSigner.signTypedData(
            domain as ethers.TypedDataDomain,
            types as Record<string, ethers.TypedDataField[]>,
            value as Record<string, any>
        );
    }
}

export default ChainSignerRpcMethods;
