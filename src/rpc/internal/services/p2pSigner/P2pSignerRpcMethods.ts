import type { P2pSignerService } from "./P2pSignerService";
import type { ConnectToChannelOptions } from "@/evm/signer/ConnectToChannelOptions";
import { AInternalRpcMethods } from "@/rpc/internal/AInternalRpcMethods";
import {
    deserializeSignerMessage,
    type SerializedSignerMessage
} from "@/rpc/internal/services/chainSigner/chainSignerSerialization";
import type { Hash, ForkId } from "@/types/types";
import { Codec, Type } from "@/utils";
import { ethers } from "ethers";

export class P2pSignerRpcMethods extends AInternalRpcMethods<P2pSignerService> {
    public async sendTransaction(encodedData: string) {
        await this.service.requireP2pSigner().sendTransaction({
            data: encodedData
        });
    }

    public async callView(encodedData: string) {
        return {
            encodedReturnData: await this.service.requireP2pSigner().call({
                data: encodedData
            })
        };
    }

    public async connectToChannel(
        channelId: string,
        options?: Omit<ConnectToChannelOptions, "balance"> & {
            encodedBalance?: string;
        }
    ) {
        return await this.service
            .requireP2pSigner()
            .connectToChannel(channelId, {
                autoOpen: options?.autoOpen,
                shouldJoin: options?.shouldJoin,
                balance: options?.encodedBalance
                    ? Codec.decode(options.encodedBalance, Type.Balance)
                    : undefined,
                timeoutMs: options?.timeoutMs
            });
    }

    public async cancelConnectToChannel(channelId: string) {
        return await this.service
            .requireP2pSigner()
            .cancelConnectToChannel(channelId);
    }

    public async leaveChannel() {
        await this.service.requireP2pSigner().leaveChannel();
    }

    public async joinLobby(
        lobbyTopic: string,
        options: { encodedBalance?: string; matchTimeoutMs?: number | null }
    ) {
        return await this.service.requireP2pSigner().joinLobby(lobbyTopic, {
            balance: options.encodedBalance
                ? Codec.decode(options.encodedBalance, Type.Balance)
                : undefined,
            matchTimeoutMs: options.matchTimeoutMs
        });
    }

    public async leaveLobby(lobbyTopic: string) {
        return await this.service.requireP2pSigner().leaveLobby(lobbyTopic);
    }

    public async joinChannel(
        encodedJoinChannelConfirmation: string,
        expectedSnapshotHash: Hash,
        expectedForkId: ForkId
    ) {
        return await this.service
            .requireP2pSigner()
            .joinChannel(
                Codec.decode(
                    encodedJoinChannelConfirmation,
                    Type.JoinChannelConfirmation
                ),
                expectedSnapshotHash,
                expectedForkId
            );
    }

    public async topUpBalance(
        encodedJoinChannelConfirmation: string,
        expectedSnapshotHash: Hash,
        expectedForkId: ForkId
    ) {
        return await this.service
            .requireP2pSigner()
            .topUpBalance(
                Codec.decode(
                    encodedJoinChannelConfirmation,
                    Type.JoinChannelConfirmation
                ),
                expectedSnapshotHash,
                expectedForkId
            );
    }

    public async collectJoinChannelConfirmation(encodedJoinChannel: string) {
        const prepared = await this.service
            .requireP2pSigner()
            .collectJoinChannelConfirmation(
                Codec.decode(encodedJoinChannel, Type.JoinChannel)
            );
        return {
            encodedJoinChannelConfirmation: Codec.encode(
                prepared.confirmation,
                Type.JoinChannelConfirmation
            ),
            expectedSnapshotHash: prepared.expectedSnapshotHash,
            expectedForkId: prepared.expectedForkId
        };
    }

    public async getChannelStatus() {
        return await this.service.requireP2pSigner().getChannelStatus();
    }

    public async setIsLeader(value: boolean) {
        this.service.requireP2pSigner().setIsLeader(value);
    }

    public async disconnectFromPeers() {
        await this.service.requireP2pSigner().disconnectFromPeers();
    }

    public async signMessage(message: SerializedSignerMessage) {
        return await this.service.signer.signMessage(
            deserializeSignerMessage(message)
        );
    }

    public async signTypedData(
        domain: ethers.TypedDataDomain,
        types: Record<string, ethers.TypedDataField[]>,
        value: Record<string, unknown>
    ) {
        return await this.service.signer.signTypedData(domain, types, value);
    }
}
