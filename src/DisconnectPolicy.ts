/** The rung of the disconnect ladder a close is applied at. */
export enum DisconnectTier {
    ALLOW = "ALLOW",
    ALLOW_RETRY = "ALLOW_RETRY",
    SUSPEND = "SUSPEND",
    BLACKLIST = "BLACKLIST"
}

/**
 * How punitive a disconnect is. Every caller of
 * `P2PManager.disconnectConnection` states one explicitly, so no close
 * inherits another caller's decision. The tiers form a ladder:
 *
 * - `ALLOW`: close the connection only. The peer keeps its profile and may
 *   reconnect; no fault ban is placed on its Hyperswarm peer info.
 * - `allowRetry(maxRetries)`: close only, but count the close against the peer
 *   for this session. The close that reaches `maxRetries` is applied as
 *   `SUSPEND` instead. There is one counter per peer, shared by every call
 *   site, so a peer cannot spread its retries over different checks.
 * - `SUSPEND`: close and bar the identity for the rest of this session. The
 *   peer's Hyperswarm peer info is banned and its reconnects are refused, but
 *   nothing is recorded on its profile and the bar dies with the session.
 * - `BLACKLIST`: the same immediate effect, plus the verdict recorded on the
 *   peer's profile. The verdict travels with the profile, outlives a session
 *   bar, and is only lifted by an explicit unblacklist.
 */
export type DisconnectPolicy =
    | { readonly tier: DisconnectTier.ALLOW }
    | { readonly tier: DisconnectTier.ALLOW_RETRY; readonly maxRetries: number }
    | { readonly tier: DisconnectTier.SUSPEND }
    | { readonly tier: DisconnectTier.BLACKLIST };

/**
 * The three constant tiers keep their plain `DisconnectPolicy.ALLOW` spelling;
 * only the bounded tier carries a value, so only it needs a factory.
 */
export const DisconnectPolicy = {
    ALLOW: { tier: DisconnectTier.ALLOW },
    SUSPEND: { tier: DisconnectTier.SUSPEND },
    BLACKLIST: { tier: DisconnectTier.BLACKLIST },
    allowRetry: (maxRetries: number): DisconnectPolicy => ({
        tier: DisconnectTier.ALLOW_RETRY,
        maxRetries
    })
} as const;

export default DisconnectPolicy;
