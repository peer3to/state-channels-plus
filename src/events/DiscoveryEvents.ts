/**
 * Argument tuples for the `discovery` bus kind (lobby/ad/acquisition events).
 * Every field is a primitive/plain object — F5 requires structured-clone-able
 * payloads only (no BigInt, no Buffer, no functions, no class instances):
 * ads cross as `encodedAd` hex strings, amounts as decimal strings.
 *
 * `intentResult` is emitted on the ACCEPTOR side — the peer that is
 * accepting/declining an inbound intent against its own ad: it is
 * the advertiser's "a peer is taking my table" signal, not something the
 * requester emits about itself.
 */
export type DiscoveryEventMap = {
    lobbyJoined: [{ topic: string; appNamespace: string }];
    lobbyLeft: [{ topic: string }];
    lobbyPeer: [{ address: string; connected: boolean; peerCount: number }];
    ad: [{ adId: string; encodedAd: string; advertiser: string }];
    adExpired: [
        { adId: string; reason: "ttl" | "withdrawn" | "peer-disconnected" }
    ];
    intentResult: [
        { adId: string; accepted: boolean; reason?: string; holdMs?: number }
    ];
    acquireStage: [
        { adId: string; stage: string; outcome: string; reason?: string }
    ];
    /**
     * `ChannelProber` progress: one entry per candidate per phase
     * ("rendezvous" | "probe"). `channelId` crosses as its string form (a
     * `ChannelId`/`BytesLike` is not itself structured-clone-safe in every
     * representation).
     */
    probeStage: [
        { channelId: string; stage: string; outcome: string; reason?: string }
    ];
};
