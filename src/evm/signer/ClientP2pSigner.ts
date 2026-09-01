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

import type {
    JoinChannelConfirmationStruct,
    JoinChannelStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import type { Status } from "@/types";
import type { Address, Bytes, ForkId, Hash } from "@/types/types";
import type { RuntimeHostEndpoint } from "../p2pRuntime/P2pRuntimeClient";
import NoopEventProvider from "./NoopEventProvider";
import { Codec, Type } from "@/utils";
import type { PreparedJoinChannelConfirmation } from "@/rpc/services";

const UNSUPPORTED =
    "Operation not supported by the p2p runtime client signer. " +
    "State channel transactions are authored by the runtime host.";

/**
 * Main-thread signer facade that forwards all supported operations across the
 * runtime message port to the host-owned signer.
 */
class ClientP2pSigner implements Signer {
    // The facade forwards calls/transactions to the host (see `call` /
    // `sendTransaction`), so this provider never routes RPC. It exists only so
    // the main-thread contract can register event subscriptions: ethers'
    // `Contract.on(...)` requires `runner.provider` to be set, and contract
    // events are then delivered via the bus mirror (`attachContractEvents`).
    provider: Provider = new NoopEventProvider();
    signerAddress: Address;
    private isLeader = false;

    constructor(
        private readonly host: RuntimeHostEndpoint,
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
        return this.host.p2pSigner
            .callView(ethers.hexlify(tx.data ?? "0x"))
            .request();
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
        await this.host.p2pSigner
            .sendTransaction(ethers.hexlify(tx.data ?? "0x"))
            .request({ timeoutMs: null });
        return "There is no TransactionResponse p2p - everything executed locally" as unknown as TransactionResponse;
    }

    signMessage(message: string | Uint8Array): Promise<string> {
        return this.host.p2pSigner
            .signMessage(
                typeof message === "string" ? message : ethers.hexlify(message)
            )
            .request();
    }

    signTypedData(
        domain: TypedDataDomain,
        types: Record<string, TypedDataField[]>,
        value: Record<string, unknown>
    ): Promise<string> {
        return this.host.p2pSigner
            .signTypedData(domain, types, value)
            .request();
    }

    async setChannelId(channelId: Bytes): Promise<void> {
        await this.host.p2pSigner.setChannelId(channelId.toString()).request();
    }

    setIsLeader(value: boolean): void {
        this.isLeader = value;
        this.host.p2pSigner.setIsLeader(value).sendOne();
    }

    getIsLeader(): boolean {
        return this.isLeader;
    }

    connectToChannel(channelId: Bytes): Promise<void> {
        return this.host.p2pSigner
            .connectToChannel(channelId.toString())
            .request({ timeoutMs: null });
    }

    async joinChannel(
        confirmation: JoinChannelConfirmationStruct,
        expectedSnapshotHash: Hash,
        expectedForkId: ForkId
    ): Promise<void> {
        await this.host.p2pSigner
            .joinChannel(
                String(
                    Codec.encode(confirmation, Type.JoinChannelConfirmation)
                ),
                String(expectedSnapshotHash),
                String(expectedForkId)
            )
            .request({ timeoutMs: null });
    }

    async topUpBalance(
        confirmation: JoinChannelConfirmationStruct,
        expectedSnapshotHash: Hash,
        expectedForkId: ForkId
    ): Promise<void> {
        await this.host.p2pSigner
            .topUpBalance(
                String(
                    Codec.encode(confirmation, Type.JoinChannelConfirmation)
                ),
                String(expectedSnapshotHash),
                String(expectedForkId)
            )
            .request({ timeoutMs: null });
    }

    async collectJoinChannelConfirmation(
        joinChannel: JoinChannelStruct
    ): Promise<PreparedJoinChannelConfirmation> {
        const result = await this.host.p2pSigner
            .collectJoinChannelConfirmation(
                String(Codec.encode(joinChannel, Type.JoinChannel))
            )
            .request();
        return {
            confirmation: Codec.decode(
                result.encodedJoinChannelConfirmation,
                Type.JoinChannelConfirmation
            ),
            expectedSnapshotHash: String(result.expectedSnapshotHash),
            expectedForkId: String(result.expectedForkId)
        };
    }

    disconnectFromPeers(): void {
        this.host.p2pSigner.disconnectFromPeers().sendOne();
    }

    getChannelStatus(): Promise<Status> {
        return this.host.p2pSigner.getChannelStatus().request();
    }
}

export default ClientP2pSigner;
