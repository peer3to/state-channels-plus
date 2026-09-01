import { ethers } from "ethers";
import ARpcMethods from "@/rpc/ARpcMethods";
import type PortRpcRouter from "@/rpc/PortRpcRouter";
import type ATransport from "@/transport/ATransport";
import type { Status } from "@/types";
import type { ForkId, Hash } from "@/types/types";
import { Codec, Type } from "@/utils";
import type { P2pRuntimeHostRoot } from "../P2pRuntimeHostRoot";
import type { P2pSignerService } from "./P2pSignerService";

/** the join confirmation the host prepared, with its structs encoded */
export type EncodedPreparedJoinChannelConfirmation = {
    encodedJoinChannelConfirmation: string;
    expectedSnapshotHash: string;
    expectedForkId: string;
};

export class P2pSignerRpcMethods extends ARpcMethods<
    PortRpcRouter<P2pRuntimeHostRoot>
> {
    constructor(
        transport: ATransport,
        private readonly service: P2pSignerService
    ) {
        super(transport, service.router);
    }

    private get p2pSigner() {
        return this.service.host.runtime().stateManager.p2pManager.p2pSigner;
    }

    /** raw calldata (hex); the host builds the transaction header and block */
    async sendTransaction(data: string): Promise<void> {
        await this.p2pSigner.sendTransaction({ data });
    }

    /** raw calldata (hex) for a read-only call */
    callView(data: string): Promise<string> {
        return this.p2pSigner.call({ data });
    }

    async connectToChannel(channelId: string): Promise<void> {
        await this.p2pSigner.connectToChannel(channelId);
    }

    async joinChannel(
        encodedJoinChannelConfirmation: string,
        expectedSnapshotHash: string,
        expectedForkId: string
    ): Promise<void> {
        await this.p2pSigner.joinChannel(
            Codec.decode(
                encodedJoinChannelConfirmation,
                Type.JoinChannelConfirmation
            ),
            expectedSnapshotHash as Hash,
            expectedForkId as ForkId
        );
    }

    async topUpBalance(
        encodedJoinChannelConfirmation: string,
        expectedSnapshotHash: string,
        expectedForkId: string
    ): Promise<void> {
        await this.p2pSigner.topUpBalance(
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
        const prepared = await this.p2pSigner.collectJoinChannelConfirmation(
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

    async setChannelId(channelId: string): Promise<void> {
        await this.p2pSigner.setChannelId(channelId);
    }

    getChannelStatus(): Promise<Status> {
        return this.p2pSigner.getChannelStatus();
    }

    /** a flag nobody waits on */
    setIsLeader(value: boolean): void {
        this.p2pSigner.setIsLeader(value);
    }

    disconnectFromPeers(): void {
        this.p2pSigner.disconnectFromPeers();
    }

    /** hex bytes or a UTF-8 string, signed by the host wallet */
    signMessage(message: string): Promise<string> {
        return this.service.host.signer.signMessage(
            ethers.isHexString(message) ? ethers.getBytes(message) : message
        );
    }

    signTypedData(
        domain: unknown,
        types: unknown,
        value: unknown
    ): Promise<string> {
        return this.service.host.signer.signTypedData(
            domain as never,
            types as never,
            value as never
        );
    }
}

export default P2pSignerRpcMethods;
