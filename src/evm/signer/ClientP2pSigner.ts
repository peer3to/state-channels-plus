import type { ConnectToChannelOptions } from "./ConnectToChannelOptions";
import NoopEventProvider from "./NoopEventProvider";
import type { RuntimeHostEndpoint } from "../p2pRuntime/P2pRuntimeClient";
import type {
    LobbyJoinOptions,
    LobbyJoinResult,
    PreparedJoinChannelConfirmation
} from "@/rpc/services";
import type { Status } from "@/types";
import type { Address, Bytes, ForkId, Hash } from "@/types/types";
import { Codec, Type } from "@/utils";
import { requireBytes32 } from "@/utils/bytes32";
import type {
    JoinChannelConfirmationStruct,
    JoinChannelStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
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

    setIsLeader(value: boolean): void {
        this.isLeader = value;
        this.host.p2pSigner.setIsLeader(value).sendOne();
    }

    getIsLeader(): boolean {
        return this.isLeader;
    }

    /** true when this call opened the channel's genesis */
    connectToChannel(
        channelId: Bytes,
        options: ConnectToChannelOptions = {}
    ): Promise<boolean> {
        let normalizedChannelId: string;
        let encodedBalance: string | undefined;
        try {
            normalizedChannelId = ethers.hexlify(channelId);
            requireBytes32(
                normalizedChannelId,
                "Channel ID must be exactly 32 bytes"
            );
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
        return this.host.p2pSigner
            .connectToChannel(
                normalizedChannelId,
                hasOptions
                    ? {
                          autoOpen: options.autoOpen,
                          shouldJoin: options.shouldJoin,
                          encodedBalance,
                          timeoutMs: options.timeoutMs
                      }
                    : undefined
            )
            .request({ timeoutMs: null });
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

    cancelConnectToChannel(channelId: Bytes): Promise<boolean> {
        let normalizedChannelId: string;
        try {
            normalizedChannelId = ethers.hexlify(channelId);
            requireBytes32(
                normalizedChannelId,
                "Channel ID must be exactly 32 bytes"
            );
        } catch (error) {
            return Promise.reject(error);
        }
        return this.host.p2pSigner
            .cancelConnectToChannel(normalizedChannelId)
            .request({ timeoutMs: null });
    }

    /** Internal route for `P2pInstance.leaveChannel`. */
    leaveChannel(): Promise<void> {
        return this.host.p2pSigner.leaveChannel().request({ timeoutMs: null });
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
        return this.host.p2pSigner
            .joinLobby(lobbyTopic, {
                encodedBalance,
                matchTimeoutMs: options.matchTimeoutMs
            })
            .request({ timeoutMs: null });
    }

    leaveLobby(lobbyTopic: string): Promise<boolean> {
        return this.host.p2pSigner
            .leaveLobby(lobbyTopic)
            .request({ timeoutMs: null });
    }

    joinChannel(
        confirmation: JoinChannelConfirmationStruct,
        expectedSnapshotHash: Hash,
        expectedForkId: ForkId
    ): Promise<boolean> {
        return this.host.p2pSigner
            .joinChannel(
                String(
                    Codec.encode(confirmation, Type.JoinChannelConfirmation)
                ),
                String(expectedSnapshotHash),
                String(expectedForkId)
            )
            .request({ timeoutMs: null });
    }

    topUpBalance(
        confirmation: JoinChannelConfirmationStruct,
        expectedSnapshotHash: Hash,
        expectedForkId: ForkId
    ): Promise<boolean> {
        return this.host.p2pSigner
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
