import {
    AbstractSigner,
    Provider,
    TransactionRequest,
    TransactionResponse,
    TypedDataDomain,
    TypedDataField,
    assert,
    hexlify
} from "ethers";

import type { RuntimeRequester } from "../p2pRuntime/types";
import {
    SerializedTransactionResponse,
    deserializeTransactionResponse,
    serializeTransactionRequest
} from "../p2pRuntime/chainSignerSerialization";

/** Real-chain signer whose key-bearing operations execute on the runtime host. */
class ClientChainSigner extends AbstractSigner {
    private readonly requester: RuntimeRequester;
    private readonly signerAddress: string;

    constructor(
        requester: RuntimeRequester,
        provider: Provider,
        signerAddress: string
    ) {
        super(provider);
        this.requester = requester;
        this.signerAddress = signerAddress;
    }

    connect(provider: Provider | null): ClientChainSigner {
        assert(
            provider === this.provider,
            "cannot reconnect host-bound chain signer",
            "UNSUPPORTED_OPERATION",
            { operation: "signer.connect" }
        );
        return this;
    }

    getAddress(): Promise<string> {
        return Promise.resolve(this.signerAddress);
    }

    async signTransaction(tx: TransactionRequest): Promise<string> {
        const serializedTransaction = await serializeTransactionRequest(
            tx,
            this.provider
        );
        return this.requester.request<string>({
            type: "chainSignerSignTransaction",
            serializedTransaction
        });
    }

    async sendTransaction(
        tx: TransactionRequest
    ): Promise<TransactionResponse> {
        const serializedTransaction = await serializeTransactionRequest(
            tx,
            this.provider
        );
        // TODO: Revisit recovery for a port that dies while the host broadcast
        // outcome is unknown. A timeout cannot cancel an in-progress send.
        const serializedResponse =
            await this.requester.request<SerializedTransactionResponse>(
                {
                    type: "chainSignerSendTransaction",
                    serializedTransaction
                },
                { timeoutMs: null }
            );
        return deserializeTransactionResponse(
            serializedResponse,
            this.provider!
        );
    }

    signMessage(message: string | Uint8Array): Promise<string> {
        return this.requester.request<string>({
            type: "chainSignerSignMessage",
            message:
                typeof message === "string"
                    ? { kind: "string", value: message }
                    : { kind: "bytes", encodedBytes: hexlify(message) }
        });
    }

    signTypedData(
        domain: TypedDataDomain,
        types: Record<string, TypedDataField[]>,
        value: Record<string, any>
    ): Promise<string> {
        return this.requester.request<string>({
            type: "chainSignerSignTypedData",
            domain,
            types,
            value
        });
    }
}

export default ClientChainSigner;
