import type JoinChannelService from "./JoinChannelService";
import ANetworkRpcMethods from "@/rpc/network/ANetworkRpcMethods";
import type NetworkTransport from "@/transport/NetworkTransport";
import type { Signature } from "@/types/types";

export default class JoinChannelRpcMethods extends ANetworkRpcMethods<JoinChannelService> {
    constructor(transport: NetworkTransport, service: JoinChannelService) {
        super(transport, service);
    }

    public async requestJoinSignature(
        encodedSignedJoinChannel: string
    ): Promise<{ signature: Signature }> {
        return this.service.signJoinRequest(
            this.senderTransport,
            encodedSignedJoinChannel
        );
    }
}
