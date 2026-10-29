import type P2PManager from "@/P2PManager";
import type { BannablePeerInfo } from "@/PeerProfile";
import { hpAddressKey } from "@/utils/hpAddressKey";

/**
 * Stand-in for Hyperswarm's peer info on the local discovery transports, so
 * the local mesh follows the same path as Holepunch: the announced peer
 * address plays the public key, and a ban is recorded per local runtime and
 * consulted by the discovery servers before they dial or accept that peer
 * again.
 */
class LocalPeerInfo implements BannablePeerInfo {
    // One banned set per runtime: several runtimes share a process in inline
    // test mode and must not see each other's bans.
    private static readonly bannedByManager = new WeakMap<
        P2PManager,
        Set<string>
    >();
    public readonly publicKey: string;
    private readonly p2pManager: P2PManager;

    constructor(p2pManager: P2PManager, peerAddress: string) {
        this.p2pManager = p2pManager;
        this.publicKey = hpAddressKey(peerAddress);
    }

    public static isBanned(
        p2pManager: P2PManager,
        peerAddress: string
    ): boolean {
        return (
            LocalPeerInfo.bannedByManager
                .get(p2pManager)
                ?.has(hpAddressKey(peerAddress)) ?? false
        );
    }

    public ban(value = true): void {
        let banned = LocalPeerInfo.bannedByManager.get(this.p2pManager);
        if (!banned) {
            banned = new Set();
            LocalPeerInfo.bannedByManager.set(this.p2pManager, banned);
        }
        if (value) banned.add(this.publicKey);
        else banned.delete(this.publicKey);
    }
}

export default LocalPeerInfo;
