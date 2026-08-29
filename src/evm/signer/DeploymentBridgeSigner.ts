import {
    ethers,
    Signer,
    TransactionRequest,
    TransactionResponse,
    Provider,
    TransactionLike
} from "ethers";

import type { RuntimeHostEndpoint } from "../p2pRuntime/P2pRuntimeClient";

const UNSUPPORTED = "Operation not supported by deployment bridge signer";

/**
 * Setup-time signer that forwards deployment signer operations to the runtime
 * host over the message port.
 */
class DeploymentBridgeSigner implements Signer {
    provider: Provider | null = null;

    constructor(
        private readonly host: RuntimeHostEndpoint,
        private readonly signerAddress: string
    ) {}

    connect(_provider: Provider | null): Signer {
        return this;
    }

    getAddress(): Promise<string> {
        return this.host.deploySigner.getAddress().request();
    }

    getNonce(): Promise<number> {
        return this.host.deploySigner.getNonce().request();
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
        return this.host.deploySigner.call(tx).request();
    }

    resolveName(name: string): Promise<string | null> {
        return this.host.deploySigner.resolveName(name).request();
    }

    signTransaction(): Promise<string> {
        return Promise.reject(new Error(UNSUPPORTED));
    }

    sendTransaction(tx: TransactionRequest): Promise<TransactionResponse> {
        return this.host.deploySigner
            .sendTransaction(tx)
            .request()
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
        return this.host.p2pSigner
            .signMessage(
                typeof message === "string" ? message : ethers.hexlify(message)
            )
            .request();
    }

    signTypedData(
        domain: ethers.TypedDataDomain,
        types: Record<string, ethers.TypedDataField[]>,
        value: Record<string, any>
    ): Promise<string> {
        return this.host.p2pSigner
            .signTypedData(domain, types, value)
            .request();
    }

    getSignerAddress(): string {
        return this.signerAddress;
    }
}

export default DeploymentBridgeSigner;
