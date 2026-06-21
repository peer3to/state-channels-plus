import {
    ethers,
    Signer,
    TransactionResponse,
    TransactionRequest,
    Provider,
    TransactionLike,
    TypedDataDomain,
    TypedDataField
} from "ethers";

import type { JoinChannelConfirmationStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import type { Status } from "@/types";
import type { Address, Bytes } from "@/types/types";
import type { RuntimeRequester } from "../p2pRuntime/types";

const UNSUPPORTED =
    "Operation not supported by the p2p runtime client signer. " +
    "State channel transactions are authored by the runtime host.";

/**
 * Main-thread signer facade that forwards all supported operations across the
 * runtime message port to the host-owned signer.
 */
class ClientP2pSigner implements Signer {
    provider: Provider | null = null;
    signerAddress: Address;
    private isLeader = false;

    constructor(
        private readonly client: RuntimeRequester,
        signerAddress: Address
    ) {
        this.signerAddress = signerAddress;
    }

    connect(_provider: Provider | null): Signer {
        return this;
    }

    getAddress(): Promise<string> {
        return Promise.resolve(this.signerAddress.toString());
    }

    getNonce(): Promise<number> {
        return Promise.reject(new Error(UNSUPPORTED));
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
        return this.client.request<string>({
            type: "callView",
            data: ethers.hexlify(tx.data ?? "0x")
        });
    }

    resolveName(): Promise<string | null> {
        return Promise.resolve(null);
    }

    signTransaction(): Promise<string> {
        return Promise.reject(new Error(UNSUPPORTED));
    }

    async sendTransaction(
        tx: TransactionRequest
    ): Promise<TransactionResponse> {
        await this.client.request<void>({
            type: "sendTransaction",
            data: ethers.hexlify(tx.data ?? "0x")
        });
        return "There is no TransactionResponse p2p - everything executed locally" as unknown as TransactionResponse;
    }

    signMessage(message: string | Uint8Array): Promise<string> {
        return this.client.request<string>({
            type: "signMessage",
            message:
                typeof message === "string" ? message : ethers.hexlify(message)
        });
    }

    signTypedData(
        domain: TypedDataDomain,
        types: Record<string, TypedDataField[]>,
        value: Record<string, unknown>
    ): Promise<string> {
        return this.client.request<string>({
            type: "signTypedData",
            domain,
            types,
            value
        });
    }

    async setChannelId(channelId: Bytes): Promise<void> {
        await this.client.request<void>({
            type: "setChannelId",
            channelId: channelId.toString()
        });
    }

    setIsLeader(value: boolean): void {
        this.isLeader = value;
        void this.client.request<void>({ type: "setIsLeader", value });
    }

    getIsLeader(): boolean {
        return this.isLeader;
    }

    connectToChannel(channelId: Bytes): Promise<void> {
        return this.client.request<void>({
            type: "connectToChannel",
            channelId: channelId.toString()
        });
    }

    async joinChannel(
        confirmation: JoinChannelConfirmationStruct
    ): Promise<void> {
        await this.client.request<void>({ type: "joinChannel", confirmation });
    }

    disconnectFromPeers(): void {
        void this.client.request<void>({ type: "disconnectFromPeers" });
    }

    getChannelStatus(): Promise<Status> {
        return this.client.request<Status>({ type: "getChannelStatus" });
    }
}

export default ClientP2pSigner;
