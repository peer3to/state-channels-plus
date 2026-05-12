import { ethers, Signer, TransactionResponse, hexlify } from "ethers";
import { ContractExecutor } from "@/evm";
import { Bytes } from "@/types/types";
import { Address } from "@ethereumjs/util";
class LocalDiamondSigner implements Signer {
    signer: Signer;
    provider: ethers.Provider | null;
    private diamondExecutor: ContractExecutor;

    constructor(signer: Signer, diamondExecutor: ContractExecutor) {
        this.signer = signer;
        this.provider = signer.provider;
        this.diamondExecutor = diamondExecutor;
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
        const caller = tx.from
            ? Address.fromString(tx.from.toString())
            : undefined;
        try {
            const result = await this.diamondExecutor.executeCall(
                tx.data as Bytes,
                caller,
                true
            );
            return hexlify(result.returnValue);
        } catch (error) {
            const e = new Error(`LocalDiamond call failed: ${error}`);
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
            const caller = tx.from
                ? Address.fromString(tx.from.toString())
                : undefined;
            await this.diamondExecutor.executeCall(tx.data as Bytes, caller);

            // Return a simple mock TransactionResponse since LocalDiamond doesn't return one
            const mockResponse = {
                hash: ethers.keccak256(tx.data as string),
                to: null,
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
                wait: async () => ({ status: 1, logs: [] }) as any
            };

            return mockResponse as unknown as TransactionResponse;
        } catch (error) {
            const e = new Error(`LocalDiamond transaction failed: ${error}`);
            (e as any).data = (error as any).data;
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

    getDiamondAddress(): string {
        return this.diamondExecutor.getContractAddress().toString();
    }
}

export default LocalDiamondSigner;
