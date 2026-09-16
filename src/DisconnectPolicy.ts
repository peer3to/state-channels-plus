/**
 * How punitive a disconnect is. Every caller of
 * `P2PManager.disconnectConnection` states one explicitly, so no close
 * inherits another caller's decision.
 *
 * - `ALLOW`: close the connection only. The peer keeps its profile and may
 *   reconnect; no fault ban is placed on its Hyperswarm peer info.
 * - `BLACKLIST`: close the connection and blacklist the profile. The identity
 *   is fault-banned and is refused on reconnect.
 */
export enum DisconnectPolicy {
    ALLOW = "ALLOW",
    BLACKLIST = "BLACKLIST"
}

export default DisconnectPolicy;
