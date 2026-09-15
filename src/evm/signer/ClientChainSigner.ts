import type { P2pRuntimeHostRoot } from "../../rpc/internal/roots/P2pRuntimeHostRoot";
import {
    deserializeTransactionResponse,
    serializeTransactionRequest
} from "../../rpc/internal/services/chainSigner/chainSignerSerialization";
import type { RuntimeConnection } from "@/rpc/internal/AInternalRpcRoot";
import { serializeSignerMessage } from "@/rpc/internal/services/chainSigner/chainSignerSerialization";
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

/** Real-chain signer whose key-bearing operations execute on the runtime host. */
class ClientChainSigner extends AbstractSigner {
    private readonly requester: RuntimeConnection<P2pRuntimeHostRoot>;
    private readonly signerAddress: string;

    constructor(
        requester: RuntimeConnection<P2pRuntimeHostRoot>,
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
        return this.requester.chainSigner
            .signTransaction(serializedTransaction)
            .request();
    }

    // Overrides AbstractSigner.sendTransaction: broadcasting runs through the host.
    override async sendTransaction(
        tx: TransactionRequest
    ): Promise<TransactionResponse> {
        const serializedTransaction = await serializeTransactionRequest(
            tx,
            this.provider
        );
        // TODO: Revisit recovery for a port that dies while the host broadcast
        // outcome is unknown. A timeout cannot cancel an in-progress send.
        const serializedResponse = await this.requester.chainSigner
            .sendTransaction(serializedTransaction)
            .request({ timeoutMs: null });
        return deserializeTransactionResponse(
            serializedResponse,
            this.provider!
        );
    }

    signMessage(message: string | Uint8Array): Promise<string> {
        return this.requester.chainSigner
            .signMessage(serializeSignerMessage(message))
            .request();
    }

    signTypedData(
        domain: TypedDataDomain,
        types: Record<string, TypedDataField[]>,
        value: Record<string, any>
    ): Promise<string> {
        return this.requester.chainSigner
            .signTypedData(domain, types, value)
            .request();
    }
}

export default ClientChainSigner;
