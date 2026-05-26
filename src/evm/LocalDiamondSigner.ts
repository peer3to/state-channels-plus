import { ethers, Signer, TransactionResponse } from "ethers";
import type {
    AContractExecutor,
    ContractExecutionResult
} from "./contractExecutor";
import { Address, Bytes } from "@/types/types";
class LocalDiamondSigner implements Signer {
    signer: Signer;
    provider: ethers.Provider | null;

    constructor(
        signer: Signer,
        private readonly contractExecutor: AContractExecutor
    ) {
        this.signer = signer;
        this.provider = signer.provider;
    }

    connect(provider: ethers.Provider | null): Signer {
        return this.signer.connect(provider);
    }

    getAddress(): Promise<string> {
        return this.signer.getAddress();
    }

    getNonce(): Promise<number> {
        return this.signer.getNonce();
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

    async call(tx: ethers.TransactionRequest): Promise<string> {
        try {
            const result = await this.contractExecutor.simulateCall(
                tx.data as Bytes,
                this.getTxContractAddress(tx)
            );
            return result.returnValue;
        } catch (error) {
            const e = new Error(`Local contract call failed: ${error}`);
            (e as any).data = (error as any).data;
            throw e;
        }
    }

    async resolveName(name: string): Promise<string | null> {
        try {
            return await this.signer.resolveName(name);
        } catch {
            const isAddress = (address: string) =>
                address.startsWith("0x") && address.length === 42;
            return isAddress(name) ? name : null;
        }
    }

    signTransaction(tx: ethers.TransactionRequest): Promise<string> {
        return this.signer.signTransaction(tx);
    }

    async sendTransaction(
        tx: ethers.TransactionRequest
    ): Promise<TransactionResponse> {
        try {
            const deployment = tx.to
                ? undefined
                : await this.contractExecutor.deploy(tx.data as Bytes);

            if (tx.to) {
                await this.contractExecutor.executeCall(
                    tx.data as Bytes,
                    this.getTxContractAddress(tx)
                );
            }

            // Return a simple mock TransactionResponse since LocalDiamond doesn't return one
            const mockResponse = {
                hash: ethers.keccak256(tx.data as string),
                to: tx.to ? tx.to.toString() : null,
                from: await this.getAddress(),
                data: tx.data as string,
                value: tx.value || BigInt(0),
                gasLimit: tx.gasLimit || BigInt(0),
                gasPrice: tx.gasPrice || BigInt(0),
                nonce: await this.getNonce(),
                chainId: tx.chainId || BigInt(0),
                type: 0,
                maxFeePerGas: null,
                maxPriorityFeePerGas: null,
                accessList: null,
                signature: null,
                blockNumber: null,
                blockHash: null,
                index: 0,
                wait: async () =>
                    this.createMockReceipt(deployment, tx.to?.toString())
            };

            return mockResponse as unknown as TransactionResponse;
        } catch (error) {
            const cause =
                error instanceof Error ? error : new Error(String(error));
            const e = new Error(
                `Local contract transaction failed: ${cause.message}`
            );
            e.stack = `${e.stack}\nCaused by: ${cause.stack ?? cause.message}`;
            (e as any).data = (cause as any).data;
            throw e;
        }
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

    private getTxContractAddress(tx: ethers.TransactionRequest): Address {
        if (!tx.to) {
            throw new Error("Local contract call requires tx.to");
        }
        return tx.to.toString();
    }

    private createMockReceipt(
        deployment?: ContractExecutionResult,
        to?: string
    ) {
        return {
            status: 1,
            logs: [],
            contractAddress: deployment?.createdAddress?.toString() ?? null,
            to: to ?? null,
            gasUsed: 0n
        } as any;
    }
}

export default LocalDiamondSigner;
