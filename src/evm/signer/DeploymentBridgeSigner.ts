import type { P2pRuntimeHostRoot } from "../../rpc/internal/roots/P2pRuntimeHostRoot";
import type { RuntimeConnection } from "@/rpc/internal/AInternalRpcRoot";
import { serializeSignerMessage } from "@/rpc/internal/services/chainSigner/chainSignerSerialization";
import { serializeTransactionRequest } from "@/rpc/internal/services/chainSigner/chainSignerSerialization";
import {
    ethers,
    Signer,
    TransactionRequest,
    TransactionResponse,
    Provider,
    TransactionLike
} from "ethers";

const UNSUPPORTED = "Operation not supported by deployment bridge signer";

/**
 * Setup-time signer that forwards deployment signer operations to the runtime
 * host over the message port.
 */
class DeploymentBridgeSigner implements Signer {
    provider: Provider | null = null;

    constructor(
        private readonly requester: RuntimeConnection<P2pRuntimeHostRoot>,
        private readonly signerAddress: string
    ) {}

    connect(_provider: Provider | null): Signer {
        return this;
    }

    getAddress(): Promise<string> {
        return this.requester.deploySigner.getAddress().request();
    }

    getNonce(): Promise<number> {
        return this.requester.deploySigner.getNonce().request();
    }

    populateCall(): Promise<TransactionLike<string>> {
        return Promise.reject(new Error(UNSUPPORTED));
    }

    populateTransaction(): Promise<TransactionLike<string>> {
        return Promise.reject(new Error(UNSUPPORTED));
    }

    estimateGas(): Promise<bigint> {
        return Promise.reject(new Error(UNSUPPORTED));
    }

    async call(tx: TransactionRequest): Promise<string> {
        const { encodedReturnData } = await this.requester.deploySigner
            .call(await serializeTransactionRequest(tx, this.provider))
            .request();
        return encodedReturnData;
    }

    resolveName(name: string): Promise<string | null> {
        return this.requester.deploySigner.resolveName(name).request();
    }

    signTransaction(): Promise<string> {
        return Promise.reject(new Error(UNSUPPORTED));
    }

    async sendTransaction(
        tx: TransactionRequest
    ): Promise<TransactionResponse> {
        return this.requester.deploySigner
            .sendTransaction(
                await serializeTransactionRequest(tx, this.provider)
            )
            .request()
            .then((result) => {
                const response = {
                    hash: result.hash,
                    to: result.to,
                    from: result.from,
                    data: result.data,
                    wait: async () =>
                        result.receipt && {
                            ...result.receipt,
                            gasUsed: BigInt(result.receipt.gasUsed)
                        }
                };
                return response as unknown as TransactionResponse;
            });
    }

    signMessage(message: string | Uint8Array): Promise<string> {
        return this.requester.p2pSigner
            .signMessage(serializeSignerMessage(message))
            .request();
    }

    signTypedData(
        domain: ethers.TypedDataDomain,
        types: Record<string, ethers.TypedDataField[]>,
        value: Record<string, any>
    ): Promise<string> {
        return this.requester.p2pSigner
            .signTypedData(domain, types, value)
            .request();
    }

    getSignerAddress(): string {
        return this.signerAddress;
    }
}

export default DeploymentBridgeSigner;
