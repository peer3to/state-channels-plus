import { ethers, Signer, TransactionResponse } from "ethers";
import { Address } from "@ethereumjs/util";
import { LocalDiamondArtifact } from "@/utils/GeneratedArtifacts";
import { ChannelId, ForkId } from "@/types/types";

class LocalDiamondSigner implements Signer {
    signer: Signer;
    localDiamondAddress: Address;
    provider: ethers.Provider | null;
    private _localDiamond?: ethers.Contract;
    private _interface?: ethers.Interface;

    constructor(signer: Signer, localDiamondAddress: Address) {
        this.signer = signer;
        this.localDiamondAddress = localDiamondAddress;
        this.provider = signer.provider;
    }

    get localDiamond(): ethers.Contract {
        if (!this._localDiamond) {
            this._localDiamond = new ethers.Contract(
                this.localDiamondAddress.toString(),
                LocalDiamondArtifact.abi,
                this.signer
            );
        }
        return this._localDiamond;
    }

    private get interface(): ethers.Interface {
        if (!this._interface) {
            this._interface = new ethers.Interface(LocalDiamondArtifact.abi);
        }
        return this._interface;
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
        const data = tx.data as string;
        if (!data || data.length < 10) {
            throw new Error("Invalid transaction data");
        }

        try {
            const decoded = this.interface.parseTransaction({ data });
            if (!decoded) {
                throw new Error("Failed to decode transaction data");
            }

            const result = await this.localDiamond[decoded.name](
                ...decoded.args
            );

            // For view functions, return the result as hex string
            if (typeof result === "string") {
                return result;
            }
            if (typeof result === "bigint" || typeof result === "number") {
                return ethers.toBeHex(result);
            }
            // For complex types, encode them
            return ethers.AbiCoder.defaultAbiCoder().encode(
                ["bytes"],
                [result]
            );
        } catch (error) {
            throw new Error(`LocalDiamond call failed: ${error}`);
        }
    }

    resolveName(name: string): Promise<string | null> {
        return this.signer.resolveName(name);
    }

    signTransaction(tx: ethers.TransactionRequest): Promise<string> {
        return this.signer.signTransaction(tx);
    }

    async sendTransaction(
        tx: ethers.TransactionRequest
    ): Promise<TransactionResponse> {
        const data = tx.data as string;
        if (!data || data.length < 10) {
            throw new Error("Invalid transaction data");
        }

        try {
            const decoded = this.interface.parseTransaction({ data });
            if (!decoded) {
                throw new Error("Failed to decode transaction data");
            }

            await this.localDiamond[decoded.name](...decoded.args);

            // Return a simple mock TransactionResponse since LocalDiamond doesn't return one
            const mockResponse = {
                hash: ethers.keccak256(data),
                to: await this.localDiamond.getAddress(),
                from: await this.getAddress(),
                data: data,
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
            throw new Error(`LocalDiamond transaction failed: ${error}`);
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

    // ========== Clean helper methods for LocalDiamond operations ==========

    async view(methodName: string, args: any[]): Promise<any> {
        const data = this.interface.encodeFunctionData(methodName, args);
        return this.call({ data });
    }

    async execute(
        methodName: string,
        args: any[]
    ): Promise<TransactionResponse> {
        const data = this.interface.encodeFunctionData(methodName, args);
        return this.sendTransaction({ data });
    }

    async onStateSnapshotUpdated(
        channelId: string,
        stateSnapshot: any,
        timestamp: number
    ): Promise<void> {
        await this.execute("onStateSnapshotUpdated", [
            channelId,
            stateSnapshot,
            timestamp
        ]);
    }

    async onJoinChannelProcessed(
        channelId: string,
        joinChannelBlock: any,
        timestamp: number,
        totalDeposits: any
    ): Promise<void> {
        await this.execute("onJoinChannelProcessed", [
            channelId,
            joinChannelBlock,
            timestamp,
            totalDeposits
        ]);
    }

    async onBlockCalldataPosted(
        channelId: string,
        sender: string,
        signedBlock: any,
        timestamp: number
    ): Promise<void> {
        await this.execute("onBlockCalldataPosted", [
            channelId,
            sender,
            signedBlock,
            timestamp
        ]);
    }

    async onDisputeCommitted(
        channelId: string,
        dispute: any,
        disputeCreationTimestamp: number,
        isFinal: boolean,
        windowCreationTimestamp: number
    ): Promise<void> {
        await this.execute("onDisputeCommitted", [
            channelId,
            dispute,
            disputeCreationTimestamp,
            isFinal,
            windowCreationTimestamp
        ]);
    }

    async onOnChainSlashAdded(
        channelId: string,
        participant: string,
        timestamp: number
    ): Promise<void> {
        await this.execute("onOnChainSlashAdded", [
            channelId,
            participant,
            timestamp
        ]);
    }

    async onDisputeKilled(
        channelId: string,
        forkId: string,
        disputer: string
    ): Promise<void> {
        await this.execute("onDisputeKilled", [channelId, forkId, disputer]);
    }

    async onDisputeReducedResultCommitted(
        channelId: string,
        forkId: string,
        reducedForkId: string,
        reductionTimestamp: number,
        forkGenesisTimestamp: number,
        reducer: string
    ): Promise<void> {
        await this.execute("onDisputeReducedResultCommitted", [
            channelId,
            forkId,
            reducedForkId,
            reductionTimestamp,
            forkGenesisTimestamp,
            reducer
        ]);
    }

    async onWithdrawalsUpdated(
        channelId: string,
        totalWithdrawals: any
    ): Promise<void> {
        await this.execute("onWithdrawalsUpdated", [
            channelId,
            totalWithdrawals
        ]);
    }

    async onChannelStorageCleared(
        channelId: string,
        latestJoinChannelBlockHash: string
    ): Promise<void> {
        await this.execute("onChannelStorageCleared", [
            channelId,
            latestJoinChannelBlockHash
        ]);
    }

    async isForkDisputed(
        channelId: ChannelId,
        forkId: ForkId
    ): Promise<boolean> {
        const result = await this.view("isForkDisputed", [channelId, forkId]);
        // Decode the boolean result
        if (typeof result === "string") {
            return ethers.AbiCoder.defaultAbiCoder().decode(
                ["bool"],
                result
            )[0];
        }
        return result;
    }
}

export default LocalDiamondSigner;
