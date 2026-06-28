import { ethers, Signer, TransactionResponse } from "ethers";
import { Mutex } from "@/utils";
import type { Logger } from "@/utils/logging/Logger";

/**
 * Signer wrapper that owns its account's nonce so concurrent async flows in one
 * peer can't collide on it.
 *
 * The SDK awaits each tx, so a single flow is already serialized — but several
 * flows (event-driven dispute/kill/challenge handlers, fire-and-forget block/
 * snapshot/open sends) run concurrently on one signer. Each would otherwise read
 * the same `pending` nonce from the chain and submit competing txs, which the
 * node rejects as `REPLACEMENT_UNDERPRICED`. We assign nonces from an owned
 * counter under a mutex instead.
 *
 * A bare `ethers.NonceManager` is unsafe here: it increments before
 * `populateTransaction` and never rolls back, so an un-gas-limited reverting call
 * whose `estimateGas` throws leaves a permanent nonce gap. We hold the mutex
 * across assign + submit and advance the counter ONLY on a successful submit, so
 * a throw leaves the counter untouched and the next send reuses the nonce.
 *
 * Only nonce assignment is serialized — the mutex is released before the caller
 * awaits `tx.wait()`, so on-chain confirmation stays concurrent. Every non-nonce
 * operation delegates unchanged to the inner signer.
 */
class ManagedNonceSigner implements Signer {
    signer: Signer;
    provider: ethers.Provider | null;

    private nextNonce: number | null = null;
    private readonly mutex: Mutex;

    constructor(signer: Signer, logger?: Logger) {
        this.signer = signer;
        this.provider = signer.provider;
        this.mutex = new Mutex(
            logger?.child({ component: "ManagedNonceSigner" })
        );
    }

    async sendTransaction(
        tx: ethers.TransactionRequest
    ): Promise<TransactionResponse> {
        await this.mutex.lock({
            taskName: "ManagedNonceSigner.sendTransaction"
        });
        try {
            if (this.nextNonce === null) {
                // Baseline from "pending" (matches ethers' NonceManager): counts
                // any already-submitted-but-unmined txs for this account.
                this.nextNonce = await this.signer.getNonce("pending");
            }
            const response = await this.signer.sendTransaction({
                ...tx,
                nonce: this.nextNonce
            });
            // The tx is in the mempool and will consume this nonce (whether it
            // ultimately succeeds or reverts on-chain), so advance the counter.
            // On a throw above the counter is left untouched — the nonce was not
            // consumed (e.g. estimateGas reverted pre-send, or the node rejected
            // it), so the next send reuses it and no gap forms.
            this.nextNonce++;
            return response;
        } finally {
            this.mutex.unlock();
        }
    }

    connect(provider: ethers.Provider | null): Signer {
        return new ManagedNonceSigner(this.signer.connect(provider));
    }

    getAddress(): Promise<string> {
        return this.signer.getAddress();
    }

    getNonce(blockTag?: ethers.BlockTag): Promise<number> {
        return this.signer.getNonce(blockTag);
    }

    populateCall(
        tx: ethers.TransactionRequest
    ): Promise<ethers.TransactionLike<string>> {
        return this.signer.populateCall(tx);
    }

    populateTransaction(
        tx: ethers.TransactionRequest
    ): Promise<ethers.TransactionLike<string>> {
        return this.signer.populateTransaction(tx);
    }

    estimateGas(tx: ethers.TransactionRequest): Promise<bigint> {
        return this.signer.estimateGas(tx);
    }

    call(tx: ethers.TransactionRequest): Promise<string> {
        return this.signer.call(tx);
    }

    resolveName(name: string): Promise<string | null> {
        return this.signer.resolveName(name);
    }

    signTransaction(tx: ethers.TransactionRequest): Promise<string> {
        return this.signer.signTransaction(tx);
    }

    signMessage(message: string | Uint8Array): Promise<string> {
        return this.signer.signMessage(message);
    }

    signTypedData(
        domain: ethers.TypedDataDomain,
        types: Record<string, ethers.TypedDataField[]>,
        value: Record<string, any>
    ): Promise<string> {
        return this.signer.signTypedData(domain, types, value);
    }
}

export default ManagedNonceSigner;
