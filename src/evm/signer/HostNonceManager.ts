import GasUsageRecorder from "@/evm/gasUsage/GasUsageRecorder";
import { Mutex } from "@/utils";
import { withGasHeadroom } from "@/utils/gas";
import type { Logger } from "@/utils/logging/Logger";
import {
    AbstractSigner,
    Provider,
    Signer,
    TransactionRequest,
    TransactionResponse,
    assert,
    keccak256
} from "ethers";

/** Host-bound nonce owner for every real-chain transaction sent by one peer. */
class HostNonceManager extends AbstractSigner {
    readonly signer: Signer;
    /** Gas of every real-chain transaction this owner broadcast. */
    readonly gasUsage: GasUsageRecorder;

    private readonly mutex: Mutex;
    private nextNonce: number | null = null;
    private nonceStateIndeterminate = false;

    constructor(signer: Signer, logger?: Logger) {
        super(signer.provider);
        this.signer = signer;
        this.gasUsage = new GasUsageRecorder(
            logger?.child({ component: "GasUsage" })
        );
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

    // Overrides AbstractSigner.estimateGas: the wrapped wallet's estimate plus
    // withGasHeadroom, so a concurrent transaction cannot push ours out of gas.
    override async estimateGas(tx: TransactionRequest): Promise<bigint> {
        return withGasHeadroom(await this.signer.estimateGas(tx));
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

    /**
     * Every real-chain transaction of this peer passes through here, which is
     * why this is also where its gas usage is observed.
     */
    // Overrides AbstractSigner.sendTransaction: broadcasts with the owned
    // nonce, then hands the response to the gas usage recorder.
    override async sendTransaction(
        tx: TransactionRequest
    ): Promise<TransactionResponse> {
        const response = await this.sendWithOwnedNonce(tx);
        this.gasUsage.observe(response);
        return response;
    }

    private async sendWithOwnedNonce(
        tx: TransactionRequest
    ): Promise<TransactionResponse> {
        await this.mutex.lock({
            taskName: "HostNonceManager.sendTransaction"
        });
        try {
            const provider = this.provider;
            assert(
                provider,
                "host nonce manager requires a provider",
                "UNSUPPORTED_OPERATION",
                { operation: "sendTransaction" }
            );
            if (this.nonceStateIndeterminate) {
                this.nextNonce = await this.signer.getNonce("pending");
                this.nonceStateIndeterminate = false;
            }
            const nonce =
                this.nextNonce ?? (await this.signer.getNonce("pending"));
            const request = { ...tx, nonce };
            const populated = await this.signer.populateTransaction({
                ...request,
                // Without a caller limit, use our estimate with headroom
                // rather than the wallet's bare estimate.
                gasLimit: tx.gasLimit ?? (await this.estimateGas(request))
            });
            const encodedTransaction =
                await this.signer.signTransaction(populated);
            // Where a recovered response starts scanning for a replacement.
            // Sent before the broadcast: the scan only walks forward, so a
            // later read could start past a replacement that already mined.
            // Not awaited: an ethers provider's broadcast joins this in-flight
            // request for its own block number, so a send makes one request
            // and waits no extra round trip. Only a failed broadcast reads it.
            const replacementScanStartBlock = provider.getBlockNumber();
            // A successful broadcast never reads it, so its failure must not
            // surface as an unhandled rejection.
            void replacementScanStartBlock.catch(() => undefined);
            try {
                const response =
                    await provider.broadcastTransaction(encodedTransaction);
                this.nextNonce = nonce + 1;
                return response;
            } catch (error) {
                return await this.reconcileBroadcastFailure(
                    encodedTransaction,
                    nonce,
                    replacementScanStartBlock,
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
        replacementScanStartBlock: Promise<number>,
        broadcastError: unknown
    ): Promise<TransactionResponse> {
        const provider = this.provider!;
        const transactionHash = keccak256(encodedTransaction);
        let observedTransaction: TransactionResponse | null;
        let pendingNonce: number;
        let scanStartBlock: number;
        try {
            // A failed start-block read cannot be retried here: a later read
            // could start past a replacement. It leaves the nonce state
            // indeterminate like any other failed reconciliation.
            [observedTransaction, pendingNonce, scanStartBlock] =
                await Promise.all([
                    provider.getTransaction(transactionHash),
                    this.signer.getNonce("pending"),
                    replacementScanStartBlock
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
            // Like a broadcast's response, its wait() ends if a replacement
            // mines; the plain node answer would wait for it forever.
            return observedTransaction.replaceableTransaction(scanStartBlock);
        }

        this.nextNonce = pendingNonce > nonce ? pendingNonce : nonce;
        throw broadcastError;
    }
}

export default HostNonceManager;
