/**
 * Narrow shape of a Holepunch (Hyperswarm) peer-info handle needed to apply
 * ban policy. Deliberately minimal so callers reach it without ever
 * importing hyperswarm types - `ProfileManager` is the only caller that
 * invokes `ban()`.
 */
export interface BannablePeerInfo {
    ban(val: boolean): void;
}
