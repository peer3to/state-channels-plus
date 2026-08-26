import ARpcMethods from "@/rpc/ARpcMethods";
import type ATransport from "@/transport/ATransport";
import type { ChannelId, ForkId, Hash, Signature } from "@/types/types";
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

    /**
     * Fire-and-forget: the sender is telling us its join for `channelId`
     * has landed on chain, so any promotion decision we deferred about it
     * is worth taking again.
     *
     * A hint, never authority. We do not promote the sender because it said
     * so - the handler re-reads the on-chain participant union, exactly as
     * it would have without the message. A peer that lies here costs us one
     * chain read and gets nothing.
     */
    public announceChannelMembership(channelId: ChannelId): void {
        this.service.handleMembershipAnnouncement(
            this.senderTransport,
            channelId
        );
    }
}
