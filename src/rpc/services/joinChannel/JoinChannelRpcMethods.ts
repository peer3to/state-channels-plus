import ARpcMethods from "@/rpc/ARpcMethods";
import type ATransport from "@/transport/ATransport";
import type { ForkId, Hash, Signature } from "@/types/types";
import type JoinChannelService from "./JoinChannelService";

export default class JoinChannelRpcMethods extends ARpcMethods {
    constructor(
        transport: ATransport,
        private readonly service: JoinChannelService
    ) {
        super(transport, service.p2pManager);
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
