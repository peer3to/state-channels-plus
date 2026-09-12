import {
    deserializeSignerMessage,
    type SignerMessage
} from "../../chainSignerSerialization";
import type { P2pRuntimeHostRoot } from "../P2pRuntimeHostRoot";
import type { P2pSignerService } from "./P2pSignerService";
import ARpcMethods from "@/rpc/ARpcMethods";
import type { RpcRouter } from "@/rpc/RpcRouter";
import type { LobbyJoinResult } from "@/rpc/services/lobbyMatching/LobbyMatchingTypes";
import type ATransport from "@/transport/ATransport";
import type { Status } from "@/types";
import type { Bytes, ForkId, Hash } from "@/types/types";
import { Codec, Type } from "@/utils";
import { ethers } from "ethers";

/** the connect options as they cross the port: the balance encoded */
type ConnectToChannelWireOptions = {
    autoOpen?: boolean;
    shouldJoin?: boolean;
    encodedBalance?: string;
    timeoutMs?: number | null;
};

/** the lobby options as they cross the port: the balance encoded */
type JoinLobbyWireOptions = {
    encodedBalance?: string;
    matchTimeoutMs?: number | null;
};

/** the join confirmation the host prepared, with its structs encoded */
type EncodedPreparedJoinChannelConfirmation = {
    encodedJoinChannelConfirmation: string;
    expectedSnapshotHash: string;
    expectedForkId: string;
};

export class P2pSignerRpcMethods extends ARpcMethods<
    RpcRouter<P2pRuntimeHostRoot, any>
> {
    constructor(
        transport: ATransport,
        private readonly service: P2pSignerService
    ) {
        super(transport, service.router);
    }

    /** raw calldata (hex); the host builds the transaction header and block */
    async sendTransaction(data: string): Promise<void> {
        await this.service.p2pSigner.sendTransaction({ data });
    }

    /** raw calldata (hex) for a read-only call */
    callView(data: string): Promise<string> {
        return this.service.p2pSigner.call({ data });
    }

    /** true when this call opened the channel's genesis */
    connectToChannel(
        channelId: string,
        options?: ConnectToChannelWireOptions
    ): Promise<boolean> {
        return this.service.p2pSigner.connectToChannel(channelId as Bytes, {
            autoOpen: options?.autoOpen,
            shouldJoin: options?.shouldJoin,
            balance:
                options?.encodedBalance === undefined
                    ? undefined
                    : Codec.decode(options.encodedBalance, Type.Balance),
            timeoutMs: options?.timeoutMs
        });
    }

    cancelConnectToChannel(channelId: string): Promise<boolean> {
        return this.service.p2pSigner.cancelConnectToChannel(
            channelId as Bytes
        );
    }

    leaveChannel(): Promise<void> {
        return this.service.p2pSigner.leaveChannel();
    }

    joinLobby(
        lobbyTopic: string,
        options?: JoinLobbyWireOptions
    ): Promise<LobbyJoinResult | undefined> {
        return this.service.p2pSigner.joinLobby(lobbyTopic, {
            balance:
                options?.encodedBalance === undefined
                    ? undefined
                    : Codec.decode(options.encodedBalance, Type.Balance),
            matchTimeoutMs: options?.matchTimeoutMs
        });
    }

    leaveLobby(lobbyTopic: string): Promise<boolean> {
        return this.service.p2pSigner.leaveLobby(lobbyTopic);
    }

    joinChannel(
        encodedJoinChannelConfirmation: string,
        expectedSnapshotHash: string,
        expectedForkId: string
    ): Promise<boolean> {
        return this.service.p2pSigner.joinChannel(
            Codec.decode(
                encodedJoinChannelConfirmation,
                Type.JoinChannelConfirmation
            ),
            expectedSnapshotHash as Hash,
            expectedForkId as ForkId
        );
    }

    topUpBalance(
        encodedJoinChannelConfirmation: string,
        expectedSnapshotHash: string,
        expectedForkId: string
    ): Promise<boolean> {
        return this.service.p2pSigner.topUpBalance(
            Codec.decode(
                encodedJoinChannelConfirmation,
                Type.JoinChannelConfirmation
            ),
            expectedSnapshotHash as Hash,
            expectedForkId as ForkId
        );
    }

    async collectJoinChannelConfirmation(
        encodedJoinChannel: string
    ): Promise<EncodedPreparedJoinChannelConfirmation> {
        const prepared =
            await this.service.p2pSigner.collectJoinChannelConfirmation(
                Codec.decode(encodedJoinChannel, Type.JoinChannel)
            );
        return {
            encodedJoinChannelConfirmation: String(
                Codec.encode(
                    prepared.confirmation,
                    Type.JoinChannelConfirmation
                )
            ),
            expectedSnapshotHash: String(prepared.expectedSnapshotHash),
            expectedForkId: String(prepared.expectedForkId)
        };
    }

    getChannelStatus(): Promise<Status> {
        return this.service.p2pSigner.getChannelStatus();
    }

    /** the reply is the ack: a host that cannot serve it must reach the caller */
    async setIsLeader(value: boolean): Promise<void> {
        this.service.p2pSigner.setIsLeader(value);
    }

    async disconnectFromPeers(): Promise<void> {
        this.service.p2pSigner.disconnectFromPeers();
    }

    /** text or bytes, told apart by the encoding, signed by the host wallet */
    signMessage(message: SignerMessage): Promise<string> {
        return this.service.host.signer.signMessage(
            deserializeSignerMessage(message)
        );
    }

    signTypedData(
        domain: ethers.TypedDataDomain,
        types: Record<string, ethers.TypedDataField[]>,
        value: Record<string, any>
    ): Promise<string> {
        return this.service.host.signer.signTypedData(domain, types, value);
    }
}

export default P2pSignerRpcMethods;
