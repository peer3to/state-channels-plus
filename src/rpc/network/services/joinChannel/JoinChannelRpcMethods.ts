import type JoinChannelService from "./JoinChannelService";
import ANetworkRpcMethods from "@/rpc/network/ANetworkRpcMethods";
import type NetworkTransport from "@/transport/NetworkTransport";
import type { ForkId, Hash, Signature } from "@/types/types";

export default class JoinChannelRpcMethods extends ANetworkRpcMethods<JoinChannelService> {
    constructor(transport: NetworkTransport, service: JoinChannelService) {
        super(transport, service);
    }

    public async requestJoinSignature(
        encodedSignedJoinChannel: string,
        expectedSnapshotHash: Hash,
        expectedForkId: ForkId
    ): Promise<{ signature: Signature }> {
        return this.service.signJoinRequest(
            this.senderTransport,
            encodedSignedJoinChannel,
            expectedSnapshotHash,
            expectedForkId
        );
    }
}
