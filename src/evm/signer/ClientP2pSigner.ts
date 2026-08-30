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
import type { RuntimeRequester } from "../p2pRuntime/types";
import NoopEventProvider from "./NoopEventProvider";
import { Codec, Type } from "@/utils";
import type {
    LobbyJoinOptions,
    LobbyJoinResult,
    PreparedJoinChannelConfirmation
} from "@/rpc/services";

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
        await this.client.request<void>(
            {
                type: "sendTransaction",
                data: ethers.hexlify(tx.data ?? "0x")
            },
            { timeoutMs: null }
        );
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
        return this.client.request<void>(
            {
                type: "connectToChannel",
                channelId: channelId.toString()
            },
            { timeoutMs: null }
        );
    }

    joinLobby(
        lobbyTopic: string,
        options: LobbyJoinOptions = {}
    ): Promise<LobbyJoinResult | undefined> {
        return this.client.request<LobbyJoinResult | undefined>(
            { type: "joinLobby", lobbyTopic, options },
            { timeoutMs: null }
        );
    }

    leaveLobby(lobbyTopic: string): Promise<boolean> {
        return this.client.request<boolean>(
            { type: "leaveLobby", lobbyTopic },
            { timeoutMs: null }
        );
    }

    async joinChannel(
        confirmation: JoinChannelConfirmationStruct,
        expectedSnapshotHash: Hash,
        expectedForkId: ForkId
    ): Promise<void> {
        await this.client.request<void>(
            {
                type: "joinChannel",
                encodedJoinChannelConfirmation: String(
                    Codec.encode(confirmation, Type.JoinChannelConfirmation)
                ),
                expectedSnapshotHash: String(expectedSnapshotHash),
                expectedForkId: String(expectedForkId)
            },
            { timeoutMs: null }
        );
    }

    async topUpBalance(
        confirmation: JoinChannelConfirmationStruct,
        expectedSnapshotHash: Hash,
        expectedForkId: ForkId
    ): Promise<void> {
        await this.client.request<void>(
            {
                type: "topUpBalance",
                encodedJoinChannelConfirmation: String(
                    Codec.encode(confirmation, Type.JoinChannelConfirmation)
                ),
                expectedSnapshotHash: String(expectedSnapshotHash),
                expectedForkId: String(expectedForkId)
            },
            { timeoutMs: null }
        );
    }

    async collectJoinChannelConfirmation(
        joinChannel: JoinChannelStruct
    ): Promise<PreparedJoinChannelConfirmation> {
        const result = await this.client.request<{
            encodedJoinChannelConfirmation: string;
            expectedSnapshotHash: Hash;
            expectedForkId: ForkId;
        }>({
            type: "collectJoinChannelConfirmation",
            encodedJoinChannel: String(
                Codec.encode(joinChannel, Type.JoinChannel)
            )
        });
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
        void this.client.request<void>({ type: "disconnectFromPeers" });
    }

    getChannelStatus(): Promise<Status> {
        return this.client.request<Status>({ type: "getChannelStatus" });
    }
}

export default ClientP2pSigner;
