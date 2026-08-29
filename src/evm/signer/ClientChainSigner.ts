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

import type { RuntimeHostEndpoint } from "../p2pRuntime/P2pRuntimeClient";
import {
    SerializedTransactionResponse,
    deserializeTransactionResponse,
    serializeTransactionRequest
} from "../p2pRuntime/chainSignerSerialization";

/** Real-chain signer whose key-bearing operations execute on the runtime host. */
class ClientChainSigner extends AbstractSigner {
    private readonly host: RuntimeHostEndpoint;
    private readonly signerAddress: string;

    constructor(
        host: RuntimeHostEndpoint,
        provider: Provider,
        signerAddress: string
    ) {
        super(provider);
        this.host = host;
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
        return this.host.chainSigner
            .signTransaction(serializedTransaction)
            .request();
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
        const serializedResponse: SerializedTransactionResponse =
            await this.host.chainSigner
                .sendTransaction(serializedTransaction)
                .request({ timeoutMs: null });
        return deserializeTransactionResponse(
            serializedResponse,
            this.provider!
        );
    }

    signMessage(message: string | Uint8Array): Promise<string> {
        return this.host.chainSigner
            .signMessage(
                typeof message === "string"
                    ? { kind: "string", value: message }
                    : { kind: "bytes", encodedBytes: hexlify(message) }
            )
            .request();
    }

    signTypedData(
        domain: TypedDataDomain,
        types: Record<string, TypedDataField[]>,
        value: Record<string, any>
    ): Promise<string> {
        return this.host.chainSigner
            .signTypedData(domain, types, value)
            .request();
    }
}

export default ClientChainSigner;
