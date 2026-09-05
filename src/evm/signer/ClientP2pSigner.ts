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
import type { ConnectToChannelOptions } from "./ConnectToChannelOptions";

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

    setIsLeader(value: boolean): void {
        this.isLeader = value;
        void this.client.request<void>({ type: "setIsLeader", value });
    }

    getIsLeader(): boolean {
        return this.isLeader;
    }

    connectToChannel(
        channelId: Bytes,
        options: ConnectToChannelOptions = {}
    ): Promise<boolean> {
        let normalizedChannelId: string;
        let encodedBalance: string | undefined;
        try {
            normalizedChannelId = ethers.hexlify(channelId);
            if (!ethers.isHexString(normalizedChannelId, 32)) {
                throw new Error("Channel ID must be exactly 32 bytes");
            }
            this.validateConnectOptions(options);
            encodedBalance =
                options.balance === undefined
                    ? undefined
                    : String(Codec.encode(options.balance, Type.Balance));
        } catch (error) {
            return Promise.reject(error);
        }
        const hasOptions =
            options.autoOpen !== undefined ||
            options.shouldJoin !== undefined ||
            options.balance !== undefined ||
            options.timeoutMs !== undefined;
        return this.client.request<boolean>(
            {
                type: "connectToChannel",
                channelId: normalizedChannelId,
                options: hasOptions
                    ? {
                          autoOpen: options.autoOpen,
                          shouldJoin: options.shouldJoin,
                          encodedBalance,
                          timeoutMs: options.timeoutMs
                      }
                    : undefined
            },
            { timeoutMs: null }
        );
    }

    cancelConnectToChannel(channelId: Bytes): Promise<boolean> {
        let normalizedChannelId: string;
        try {
            normalizedChannelId = ethers.hexlify(channelId);
            if (!ethers.isHexString(normalizedChannelId, 32)) {
                throw new Error("Channel ID must be exactly 32 bytes");
            }
        } catch (error) {
            return Promise.reject(error);
        }
        return this.client.request<boolean>(
            {
                type: "cancelConnectToChannel",
                channelId: normalizedChannelId
            },
            { timeoutMs: null }
        );
    }

    /**
     * Internal route for `P2pInstance.leaveChannel`.
     * Direct callers wait for settled removal but do not dispose the runtime.
     */
    leaveChannel(): Promise<void> {
        return this.client.request<void>(
            { type: "leaveChannel" },
            { timeoutMs: null }
        );
    }

    joinLobby(
        lobbyTopic: string,
        options: LobbyJoinOptions = {}
    ): Promise<LobbyJoinResult | undefined> {
        let encodedBalance: string | undefined;
        try {
            encodedBalance =
                options.balance === undefined
                    ? undefined
                    : String(Codec.encode(options.balance, Type.Balance));
        } catch (error) {
            return Promise.reject(error);
        }
        return this.client.request<LobbyJoinResult | undefined>(
            {
                type: "joinLobby",
                lobbyTopic,
                options: {
                    encodedBalance,
                    matchTimeoutMs: options.matchTimeoutMs
                }
            },
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
    ): Promise<boolean> {
        return this.client.request<boolean>(
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
    ): Promise<boolean> {
        return this.client.request<boolean>(
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

    private validateConnectOptions(options: ConnectToChannelOptions): void {
        if (
            options.autoOpen !== undefined &&
            typeof options.autoOpen !== "boolean"
        ) {
            throw new Error("autoOpen must be a boolean");
        }
        if (
            options.shouldJoin !== undefined &&
            typeof options.shouldJoin !== "boolean"
        ) {
            throw new Error("shouldJoin must be a boolean");
        }
        if (
            options.timeoutMs !== undefined &&
            options.timeoutMs !== null &&
            (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0)
        ) {
            throw new Error(
                "timeoutMs must be a positive finite integer or null"
            );
        }
    }
}

export default ClientP2pSigner;
