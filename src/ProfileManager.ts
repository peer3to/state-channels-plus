import { Address, HpAddress, PeerKey } from "./types/types";
import { getChecksumAddress, hpAddressKey } from "./utils";
import { LoggerUtils } from "./utils/LoggerUtils";
import { runCleanupSync } from "./utils/runCleanup";
import PeerProfile, { BannablePeerInfo } from "@/PeerProfile";
import type {
    BlacklistReason,
    BlacklistStorage
} from "@/storage/BlacklistStorage";
import { isNetworkTransport } from "@/transport/NetworkTransport";
import NetworkTransport from "@/transport/NetworkTransport";
import { TransportType } from "@/transport/TransportType";

/** Strike value of a peer barred for the rest of this session. */
const SUSPENDED = Number.POSITIVE_INFINITY;
const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

// ProfileManager alone owns explicit bans, upgrade bans, and fallback release.
// An explicit blacklist always wins over transport fallback. It also owns the
// session-scoped half of the disconnect ladder: one strike count per peer key
// that saturates into a suspension. The strikes live on the manager rather
// than on a profile, so they die with the session; the blacklist verdict is
// recorded in storage so it can outlive it.
class ProfileManager {
    private readonly mapTransportToProfile = new Map<
        NetworkTransport,
        PeerProfile
    >();
    private mapEvmAddressToProfile: Map<Address, PeerProfile> = new Map();
    private mapHpAddressToProfile: Map<HpAddress, PeerProfile> = new Map<
        HpAddress,
        PeerProfile
    >();
    // Keys are normalized peer keys (checksummed EVM address once proven, the
    // lowercase Hyperswarm key before); values count the retry-tier
    // disconnects taken against that peer in this session, or SUSPENDED once
    // the peer is barred for the rest of it. Never reset.
    private readonly mapPeerKeyToStrikes = new Map<PeerKey, number>();
    private readonly blacklistStorage: BlacklistStorage;

    constructor(blacklistStorage: BlacklistStorage) {
        this.blacklistStorage = blacklistStorage;
    }

    /** Close every registered transport, including peers still authenticating. */
    public dispose(): void {
        // Snapshot the keys: removeTransport restores an entry when close fails.
        runCleanupSync(
            ...[...this.mapTransportToProfile.keys()].map((transport) => () => {
                this.removeTransport(transport);
            }),
            () => this.mapTransportToProfile.clear(),
            () => this.mapEvmAddressToProfile.clear(),
            () => this.mapHpAddressToProfile.clear(),
            () => this.mapPeerKeyToStrikes.clear()
        );
    }

    public registerTransport(transport: NetworkTransport): PeerProfile {
        const existingProfile = this.mapTransportToProfile.get(transport);
        if (existingProfile) return existingProfile;

        transport.p2pManager.logger.debug(
            "Registering peer transport",
            LoggerUtils.getTransportMetadata(transport)
        );
        const profile = new PeerProfile(transport);
        this.mapTransportToProfile.set(transport, profile);
        return profile;
    }

    public registerProfile(profile: PeerProfile) {
        const evmAddress = profile.getEvmAddress();
        const transport = profile.getTransport();
        if (transport) {
            this.attachTransportProfile(transport, profile);
        }
        if (evmAddress)
            this.mapEvmAddressToProfile.set(
                getChecksumAddress(evmAddress),
                profile
            );
        const hpAddress = profile.getHpAddress();
        if (hpAddress) {
            this.mapHpAddressToProfile.set(hpAddress, profile);
        }
    }
    public authenticateTransport(
        transport: NetworkTransport,
        evmAddress: Address
    ): PeerProfile | undefined {
        const normalizedAddress = getChecksumAddress(evmAddress);
        const existingProfile =
            this.mapEvmAddressToProfile.get(normalizedAddress);
        // Both exclusions are checked independently of the profile: a
        // recorded verdict or a suspended identity that dials back on a fresh
        // handle has no profile of its own to carry the bar.
        const isBlacklisted = this.isBlacklisted(normalizedAddress);
        const isSuspended = this.isSuspended(normalizedAddress);
        if (isBlacklisted || isSuspended) {
            transport.p2pManager.logger.warn(
                "Rejecting transport for excluded profile",
                {
                    ...LoggerUtils.getTransportMetadata(transport),
                    peerAddress: normalizedAddress,
                    blacklisted: isBlacklisted,
                    suspended: isSuspended
                }
            );
            // Re-apply the exclusion to the arriving transport so its own peer
            // info is banned too; a bare close lets the peer redial.
            if (isBlacklisted) {
                this.blacklistPeer(transport, "returning blacklisted identity");
            } else {
                this.suspendPeer(transport);
            }
            transport.close(true);
            return undefined;
        }
        if (existingProfile) {
            const currentTransport = existingProfile.getTransport();
            if (
                currentTransport?.transportType === TransportType.WEBRTC &&
                !currentTransport.isClosed &&
                transport.transportType === TransportType.HOLEPUNCH
            ) {
                transport.p2pManager.logger.debug(
                    "Rejecting Holepunch transport while WebRTC remains live",
                    LoggerUtils.getTransportMetadata(transport)
                );
                transport.close(true);
                return undefined;
            }
        }

        transport.peerAddress = normalizedAddress;
        if (existingProfile) {
            this.updateTransport(normalizedAddress, transport);
            return existingProfile;
        }

        const profile = this.registerTransport(transport);
        profile.setEvmAddress(normalizedAddress);
        this.registerProfile(profile);
        return profile;
    }
    public unregisterProfile(
        profile: PeerProfile,
        detachedTransport?: NetworkTransport
    ) {
        const transport = profile.getTransport();
        if (transport) this.mapTransportToProfile.delete(transport);
        if (detachedTransport)
            this.mapTransportToProfile.delete(detachedTransport);
        const evmAddress = profile.getEvmAddress();
        if (evmAddress)
            this.mapEvmAddressToProfile.delete(getChecksumAddress(evmAddress));
        const hpAddress = profile.getHpAddress();
        if (hpAddress) this.mapHpAddressToProfile.delete(hpAddress);
        profile.removeHolepunchPeerInfo();
    }
    public updateTransport(
        profileAddress: string,
        newTransport: NetworkTransport
    ) {
        const profile = this.mapEvmAddressToProfile.get(
            getChecksumAddress(profileAddress)
        );
        if (!profile) return;
        const oldTransport = profile.getTransport();
        if (oldTransport) {
            const logger = oldTransport.p2pManager.logger;
            LoggerUtils.logTransportReplacement(
                logger,
                oldTransport,
                newTransport,
                profileAddress
            );

            this.applyUpgradeBanPolicy(oldTransport, newTransport, profile);

            const stateManager = oldTransport.p2pManager.stateManager;
            stateManager.timeoutManager.scheduleTask(
                () => {
                    // allow agreementTime for everyone to update transport and start using new one, before closing this one
                    if (profile.getTransport() === oldTransport) return;
                    this.removeTransport(oldTransport, true);
                },
                stateManager.timeConfig.agreementTime * 1000,
                "transport upgrade grace period elapsed – retiring old transport"
            );
        }

        this.attachTransportProfile(newTransport, profile);
    }
    public removeTransport(transport: NetworkTransport, isUpgraded = false) {
        const profile = this.mapTransportToProfile.get(transport);
        if (!profile) return;
        transport.p2pManager.logger.debug("Removing peer transport", {
            ...LoggerUtils.getTransportMetadata(transport),
            isUpgraded,
            profile: LoggerUtils.getPeerProfileMetadata(profile)
        });
        this.mapTransportToProfile.delete(transport);
        profile.detachTransport(transport);
        try {
            transport.close(isUpgraded);
        } catch (error) {
            this.mapTransportToProfile.set(transport, profile);
            throw error;
        }
    }
    public getProfileByTransport(
        transport: NetworkTransport
    ): PeerProfile | undefined {
        const transportProfile = this.mapTransportToProfile.get(transport);
        if (transportProfile) return transportProfile;
        if (!transport.peerAddress) return undefined;

        const identityProfile = this.mapEvmAddressToProfile.get(
            getChecksumAddress(transport.peerAddress)
        );
        if (!identityProfile?.hasLiveTransport(transport)) return undefined;

        this.mapTransportToProfile.set(transport, identityProfile);
        return identityProfile;
    }
    public getProfileByEvmAddress(
        evmAddress: Address
    ): PeerProfile | undefined {
        return this.mapEvmAddressToProfile.get(getChecksumAddress(evmAddress));
    }
    public getProfileByHpAddress(
        hpAddress: HpAddress
    ): PeerProfile | undefined {
        return this.mapHpAddressToProfile.get(hpAddressKey(hpAddress));
    }

    public getTransportByEvmAddress(
        evmAddress: Address
    ): NetworkTransport | null {
        const transport =
            this.getProfileByEvmAddress(evmAddress)?.getTransport() ?? null;
        return transport && !transport.isClosed ? transport : null;
    }

    /**
     * The single writer of a profile's Hyperswarm identity. The key is known
     * before any handshake, so a suspended key that dials back is refused
     * here, before the handshake spends any work on it.
     */
    public setBannablePeerInfo(
        transport: NetworkTransport,
        peerInfo: BannablePeerInfo
    ): void {
        const profile = this.registerTransport(transport);
        profile.setHolepunchPeerInfo(peerInfo);
        const hpAddress =
            peerInfo.publicKey === undefined
                ? undefined
                : hpAddressKey(peerInfo.publicKey);
        if (!hpAddress) return;
        profile.setHpAddress(hpAddress);
        this.mapHpAddressToProfile.set(hpAddress, profile);
        if (!this.isSuspended(hpAddress)) return;
        transport.p2pManager.logger.warn(
            "Rejecting transport for suspended peer key",
            { ...LoggerUtils.getTransportMetadata(transport), hpAddress }
        );
        peerInfo.ban(true);
        transport.close(true);
    }

    /** The identity strikes count against: the EVM address once proven, else the key. */
    public profileKey(profile: PeerProfile): PeerKey | undefined {
        const evmAddress = profile.getEvmAddress();
        if (evmAddress) return getChecksumAddress(evmAddress);
        return profile.getHpAddress();
    }

    public isBlacklisted(evmAddress: Address): boolean {
        return (
            (this.getProfileByEvmAddress(evmAddress)?.isBlackListed ?? false) ||
            this.blacklistStorage.has(evmAddress)
        );
    }

    /**
     * The profile a fault on `transport` is charged to: the proven identity's
     * profile when the transport carries one (so a fault reported on a retired
     * transport still reaches the current profile), else the transport's own.
     */
    public getProfileForFault(
        transport: NetworkTransport
    ): PeerProfile | undefined {
        return (
            (transport.peerAddress
                ? this.getProfileByEvmAddress(transport.peerAddress)
                : undefined) ?? this.getProfileByTransport(transport)
        );
    }

    public blacklistPeer(
        peer: NetworkTransport | Address,
        reason: BlacklistReason = "unspecified"
    ): void {
        if (isNetworkTransport(peer)) {
            const profile = this.getProfileByTransport(peer);
            if (profile) this.blacklistProfile(profile, reason);
            return;
        }

        const profile = this.getProfileByEvmAddress(peer);
        if (!profile) {
            // An identity with no profile is still recorded; there is simply
            // nothing to close or ban yet.
            this.blacklistStorage.record(peer, reason);
            return;
        }
        this.blacklistProfile(profile, reason);
    }

    /**
     * Session-scoped exclusion: bar every identity the peer has (its EVM
     * address and its Hyperswarm key) and ban its peer info so it is not
     * redialled for the rest of this session. Unlike the blacklist it records
     * no verdict and has no release path.
     */
    public suspendPeer(peer: NetworkTransport | Address): void {
        if (isNetworkTransport(peer)) {
            const profile = this.getProfileByTransport(peer);
            if (profile) this.suspendProfile(profile);
            return;
        }

        // An identity with no profile is still barred; there is simply no
        // peer info to ban yet.
        this.markSuspended(peer);
        const profile = this.getProfileByEvmAddress(peer);
        if (profile) this.suspendProfile(profile);
    }

    public isSuspended(key: PeerKey): boolean {
        return (
            this.mapPeerKeyToStrikes.get(ProfileManager.normalizeKey(key)) ===
            SUSPENDED
        );
    }

    /** Strikes recorded against a key in this session; SUSPENDED once barred. */
    public getStrikes(key: PeerKey): number {
        return (
            this.mapPeerKeyToStrikes.get(ProfileManager.normalizeKey(key)) ?? 0
        );
    }

    /**
     * Count one retry-tier disconnect for this peer and report whether the
     * session bound is now reached. One counter per peer, shared by every call
     * site, so a peer cannot spread its retries over different checks. The
     * strike that reaches the bound saturates the entry into a suspension.
     */
    public countRetryDisconnect(key: PeerKey, maxRetries: number): boolean {
        const normalizedKey = ProfileManager.normalizeKey(key);
        const strikes = (this.mapPeerKeyToStrikes.get(normalizedKey) ?? 0) + 1;
        const boundReached = strikes >= maxRetries;
        this.mapPeerKeyToStrikes.set(
            normalizedKey,
            boundReached ? SUSPENDED : strikes
        );
        return boundReached;
    }

    public unblacklistPeer(evmAddress: Address): boolean {
        const removed = this.blacklistStorage.remove(evmAddress);
        const profile = this.getProfileByEvmAddress(evmAddress);
        if (!profile) return removed;

        profile.unblacklist();
        const hasLiveWebRtc = profile
            .getLiveTransports()
            .some(
                (transport) => transport.transportType === TransportType.WEBRTC
            );
        if (!hasLiveWebRtc && !this.isProfileSuspended(profile)) {
            profile.getHolepunchPeerInfo()?.ban(false);
        }
        return true;
    }

    public releaseHolepunchBanOnWebRtcClose(transport: NetworkTransport): void {
        if (transport.transportType !== TransportType.WEBRTC) return;
        const profile = this.getProfileByTransport(transport);
        if (
            !profile ||
            !profile.isPreferredTransport(transport) ||
            this.isProfileExcluded(profile)
        ) {
            return;
        }
        transport.p2pManager.logger.debug(
            "Releasing Holepunch upgrade ban after WebRTC close",
            LoggerUtils.getTransportMetadata(transport)
        );
        profile.getHolepunchPeerInfo()?.ban(false);
    }

    private blacklistProfile(
        profile: PeerProfile,
        reason: BlacklistReason
    ): void {
        const evmAddress = profile.getEvmAddress();
        if (evmAddress) {
            this.blacklistStorage.record(
                getChecksumAddress(evmAddress),
                reason
            );
        }
        profile.blacklist();
        profile.getHolepunchPeerInfo()?.ban(true);
    }

    private suspendProfile(profile: PeerProfile): void {
        const evmAddress = profile.getEvmAddress();
        if (evmAddress) this.markSuspended(evmAddress);
        const hpAddress = profile.getHpAddress();
        if (hpAddress) this.markSuspended(hpAddress);
        profile.getHolepunchPeerInfo()?.ban(true);
    }

    /** The one writer of a suspension, so every key form lands normalized. */
    private markSuspended(key: PeerKey): void {
        this.mapPeerKeyToStrikes.set(
            ProfileManager.normalizeKey(key),
            SUSPENDED
        );
    }

    private isProfileSuspended(profile: PeerProfile): boolean {
        const evmAddress = profile.getEvmAddress();
        const hpAddress = profile.getHpAddress();
        return (
            (evmAddress !== undefined && this.isSuspended(evmAddress)) ||
            (hpAddress !== undefined && this.isSuspended(hpAddress))
        );
    }

    /** Either half of the ladder keeps a ban in place. */
    private isProfileExcluded(profile: PeerProfile): boolean {
        return profile.isBlackListed || this.isProfileSuspended(profile);
    }

    private applyUpgradeBanPolicy(
        oldTransport: NetworkTransport,
        newTransport: NetworkTransport,
        profile: PeerProfile
    ): void {
        if (
            oldTransport.transportType !== TransportType.HOLEPUNCH ||
            newTransport.transportType !== TransportType.WEBRTC
        ) {
            if (
                oldTransport.transportType === TransportType.WEBRTC &&
                newTransport.transportType === TransportType.HOLEPUNCH &&
                !this.isProfileExcluded(profile)
            ) {
                profile.getHolepunchPeerInfo()?.ban(false);
            }
            return;
        }
        profile.getHolepunchPeerInfo()?.ban(true);
    }

    private attachTransportProfile(
        transport: NetworkTransport,
        profile: PeerProfile
    ): void {
        const transportProfile = this.mapTransportToProfile.get(transport);
        if (transportProfile && transportProfile !== profile) {
            profile.absorbLifecycleFrom(transportProfile);
            transportProfile.detachTransport(transport);
        }
        this.mapTransportToProfile.set(transport, profile);
        profile.attachTransport(transport);
    }

    /** EVM keys are checksummed; Hyperswarm keys are lowercase hex. */
    private static normalizeKey(key: PeerKey): PeerKey {
        const text = String(key);
        return EVM_ADDRESS_PATTERN.test(text)
            ? getChecksumAddress(text)
            : hpAddressKey(text);
    }
}

export default ProfileManager;
