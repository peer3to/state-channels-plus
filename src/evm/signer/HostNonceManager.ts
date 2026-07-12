import {
    AbstractSigner,
    Provider,
    Signer,
    TransactionRequest,
    TransactionResponse,
    assert,
    keccak256
} from "ethers";

import { Mutex } from "@/utils";
import type { Logger } from "@/utils/logging/Logger";

/** Host-bound nonce owner for every real-chain transaction sent by one peer. */
class HostNonceManager extends AbstractSigner {
    readonly signer: Signer;

    private readonly mutex: Mutex;
    private nextNonce: number | null = null;
    private nonceStateIndeterminate = false;

    constructor(signer: Signer, logger?: Logger) {
        super(signer.provider);
        this.signer = signer;
        this.mutex = new Mutex(
            logger?.child({ component: "HostNonceManager" })
        );
    }

    connect(provider: Provider | null): HostNonceManager {
        assert(
            provider === this.provider,
            "cannot reconnect host nonce manager",
            "UNSUPPORTED_OPERATION",
            { operation: "signer.connect" }
        );
        return this;
    }

    getAddress(): Promise<string> {
        return this.signer.getAddress();
    }

    signTransaction(tx: TransactionRequest): Promise<string> {
        return this.signer.signTransaction(tx);
    }

    signMessage(message: string | Uint8Array): Promise<string> {
        return this.signer.signMessage(message);
    }

    signTypedData(
        domain: Parameters<Signer["signTypedData"]>[0],
        types: Parameters<Signer["signTypedData"]>[1],
        value: Parameters<Signer["signTypedData"]>[2]
    ): Promise<string> {
        return this.signer.signTypedData(domain, types, value);
    }

    async sendTransaction(
        tx: TransactionRequest
    ): Promise<TransactionResponse> {
        await this.mutex.lock({
            taskName: "HostNonceManager.sendTransaction"
        });
        try {
            assert(
                !this.nonceStateIndeterminate,
                "cannot send while the account nonce state is indeterminate",
                "UNKNOWN_ERROR",
                { operation: "sendTransaction" }
            );
            const provider = this.provider;
            assert(
                provider,
                "host nonce manager requires a provider",
                "UNSUPPORTED_OPERATION",
                { operation: "sendTransaction" }
            );
            const nonce =
                this.nextNonce ?? (await this.signer.getNonce("pending"));
            const populated = await this.signer.populateTransaction({
                ...tx,
                nonce
            });
            const encodedTransaction =
                await this.signer.signTransaction(populated);
            try {
                const response =
                    await provider.broadcastTransaction(encodedTransaction);
                this.nextNonce = nonce + 1;
                return response;
            } catch (error) {
                return await this.reconcileBroadcastFailure(
                    encodedTransaction,
                    nonce,
                    error
                );
            }
        } finally {
            this.mutex.unlock();
        }
    }

    private async reconcileBroadcastFailure(
        encodedTransaction: string,
        nonce: number,
        broadcastError: unknown
    ): Promise<TransactionResponse> {
        const provider = this.provider!;
        const transactionHash = keccak256(encodedTransaction);
        let observedTransaction: TransactionResponse | null;
        let pendingNonce: number;
        try {
            [observedTransaction, pendingNonce] = await Promise.all([
                provider.getTransaction(transactionHash),
                this.signer.getNonce("pending")
            ]);
        } catch (reconciliationError) {
            this.nonceStateIndeterminate = true;
            throw new Error(
                "broadcast failed and the account nonce state could not be reconciled: " +
                    `${String(broadcastError)}; ${String(reconciliationError)}`
            );
        }

        if (observedTransaction) {
            this.nextNonce = Math.max(nonce + 1, pendingNonce);
            return observedTransaction;
        }

        this.nextNonce = pendingNonce > nonce ? pendingNonce : nonce;
        throw broadcastError;
    }
}

export default HostNonceManager;
