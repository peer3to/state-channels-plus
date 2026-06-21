import {
    ethers,
    Signer,
    TransactionRequest,
    TransactionResponse,
    Provider,
    TransactionLike
} from "ethers";

import type { RuntimeRequester } from "../p2pRuntime/types";

const UNSUPPORTED = "Operation not supported by deployment bridge signer";

/**
 * Setup-time signer that forwards deployment signer operations to the runtime
 * host over the message port.
 */
class DeploymentBridgeSigner implements Signer {
    provider: Provider | null = null;

    constructor(
        private readonly requester: RuntimeRequester,
        private readonly signerAddress: string
    ) {}

    connect(_provider: Provider | null): Signer {
        return this;
    }

    getAddress(): Promise<string> {
        return this.requester.request<string>({
            type: "deploySignerGetAddress"
        });
    }

    getNonce(): Promise<number> {
        return this.requester.request<number>({ type: "deploySignerGetNonce" });
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

    call(tx: TransactionRequest): Promise<string> {
        return this.requester.request<string>({
            type: "deploySignerCall",
            tx
        });
    }

    resolveName(name: string): Promise<string | null> {
        return this.requester.request<string | null>({
            type: "deploySignerResolveName",
            name
        });
    }

    signTransaction(): Promise<string> {
        return Promise.reject(new Error(UNSUPPORTED));
    }

    sendTransaction(tx: TransactionRequest): Promise<TransactionResponse> {
        return this.requester
            .request<{
                hash: string;
                to: string | null;
                from: string;
                data: string;
                receipt: unknown;
            }>({
                type: "deploySignerSendTransaction",
                tx
            })
            .then((result) => {
                const response = {
                    hash: result.hash,
                    to: result.to,
                    from: result.from,
                    data: result.data,
                    wait: async () => result.receipt
                };
                return response as unknown as TransactionResponse;
            });
    }

    signMessage(message: string | Uint8Array): Promise<string> {
        return this.requester.request<string>({
            type: "signMessage",
            message:
                typeof message === "string" ? message : ethers.hexlify(message)
        });
    }

    signTypedData(
        domain: ethers.TypedDataDomain,
        types: Record<string, ethers.TypedDataField[]>,
        value: Record<string, any>
    ): Promise<string> {
        return this.requester.request<string>({
            type: "signTypedData",
            domain,
            types,
            value
        });
    }

    getSignerAddress(): string {
        return this.signerAddress;
    }
}

export default DeploymentBridgeSigner;
