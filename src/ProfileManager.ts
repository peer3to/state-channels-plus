import { Address } from "./types/types";
import { getChecksumAddress } from "./utils";
import { LoggerUtils } from "./utils/LoggerUtils";
import { runCleanupSync } from "./utils/runCleanup";
import PeerProfile, { BannablePeerInfo } from "@/PeerProfile";
import NetworkTransport from "@/transport/NetworkTransport";
import { TransportType } from "@/transport/TransportType";

// ProfileManager alone owns explicit bans, upgrade bans, and fallback release.
// An explicit blacklist always wins over transport fallback. It also owns the
// two session-scoped halves of the disconnect ladder: the suspension set and
// the retry counters. Both live on the manager rather than on a profile, so
// they die with the session instead of travelling with a recorded verdict.
class ProfileManager {
    private readonly mapTransportToProfile = new Map<
        NetworkTransport,
        PeerProfile
    >();
    private mapEvmAddressToProfile: Map<Address, PeerProfile> = new Map();
    private mapHpAddressToProfile: Map<Address, PeerProfile> = new Map<
        Address,
        PeerProfile
    >();
    // Checksummed EVM addresses barred for the rest of this session.
    private readonly suspendedEvmAddresses = new Set<Address>();
    // Keys are checksummed EVM addresses; values count the retry-tier
    // disconnects taken against that peer in this session. Never reset.
    private readonly mapEvmAddressToRetryCount = new Map<Address, number>();

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
            () => this.suspendedEvmAddresses.clear(),
            () => this.mapEvmAddressToRetryCount.clear()
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
        // The suspension set is checked independently of the profile: a
        // suspended identity that dials back on a fresh handle has no profile
        // of its own to carry the bar.
        const isSuspended = this.isSuspended(normalizedAddress);
        if (existingProfile?.isBlackListed || isSuspended) {
            transport.p2pManager.logger.warn(
                "Rejecting transport for excluded profile",
                {
                    ...LoggerUtils.getTransportMetadata(transport),
                    peerAddress: normalizedAddress,
                    blacklisted: existingProfile?.isBlackListed ?? false,
                    suspended: isSuspended
                }
            );
            // Re-apply the exclusion to the arriving transport so its own peer
            // info is banned too; a bare close lets the peer redial.
            if (existingProfile?.isBlackListed) this.blacklistPeer(transport);
            else this.suspendPeer(transport);
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
    public getProfileByHpAddress(hpAddress: Address): PeerProfile | undefined {
        return this.mapHpAddressToProfile.get(hpAddress);
    }

    public getTransportByEvmAddress(
        evmAddress: Address
    ): NetworkTransport | null {
        const transport =
            this.getProfileByEvmAddress(evmAddress)?.getTransport() ?? null;
        return transport && !transport.isClosed ? transport : null;
    }

    public setBannablePeerInfo(
        transport: NetworkTransport,
        peerInfo: BannablePeerInfo
    ): void {
        this.registerTransport(transport).setHolepunchPeerInfo(peerInfo);
    }

    public blacklistPeer(
        peer: NetworkTransport | Address
    ): NetworkTransport | undefined {
        if (peer instanceof NetworkTransport) {
            const profile = this.getProfileByTransport(peer);
            if (profile) this.blacklistProfile(profile);
            return peer;
        }

        const profile = this.getProfileByEvmAddress(peer);
        if (!profile) return undefined;
        this.blacklistProfile(profile);
        return profile.getTransport();
    }

    /**
     * Session-scoped exclusion: bar the identity and ban its Hyperswarm peer
     * info so the peer is not redialled for the rest of this session. Unlike
     * the blacklist it records no verdict on the profile and has no release
     * path.
     */
    public suspendPeer(
        peer: NetworkTransport | Address
    ): NetworkTransport | undefined {
        if (peer instanceof NetworkTransport) {
            const profile = this.getProfileByTransport(peer);
            if (profile) this.suspendProfile(profile);
            return peer;
        }

        const profile = this.getProfileByEvmAddress(peer);
        if (!profile) {
            // An identity with no profile is still barred; there is simply no
            // peer info to ban yet.
            this.suspendedEvmAddresses.add(getChecksumAddress(peer));
            return undefined;
        }
        this.suspendProfile(profile);
        return profile.getTransport();
    }

    public isSuspended(evmAddress: Address): boolean {
        return this.suspendedEvmAddresses.has(getChecksumAddress(evmAddress));
    }

    /**
     * Count one retry-tier disconnect for this peer and report whether the
     * session bound is now reached. One counter per peer, shared by every call
     * site, so a peer cannot spread its retries over different checks.
     */
    public countRetryDisconnect(
        evmAddress: Address,
        maxRetries: number
    ): boolean {
        const normalizedAddress = getChecksumAddress(evmAddress);
        const count =
            (this.mapEvmAddressToRetryCount.get(normalizedAddress) ?? 0) + 1;
        this.mapEvmAddressToRetryCount.set(normalizedAddress, count);
        return count >= maxRetries;
    }

    public unblacklistPeer(evmAddress: Address): boolean {
        const profile = this.getProfileByEvmAddress(evmAddress);
        if (!profile) return false;

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
            profile.isBlackListed ||
            this.isProfileSuspended(profile)
        ) {
            return;
        }
        transport.p2pManager.logger.debug(
            "Releasing Holepunch upgrade ban after WebRTC close",
            LoggerUtils.getTransportMetadata(transport)
        );
        profile.getHolepunchPeerInfo()?.ban(false);
    }

    private blacklistProfile(profile: PeerProfile): void {
        profile.blacklist();
        profile.getHolepunchPeerInfo()?.ban(true);
    }

    private suspendProfile(profile: PeerProfile): void {
        const evmAddress = profile.getEvmAddress();
        if (evmAddress) {
            this.suspendedEvmAddresses.add(getChecksumAddress(evmAddress));
        }
        profile.getHolepunchPeerInfo()?.ban(true);
    }

    private isProfileSuspended(profile: PeerProfile): boolean {
        const evmAddress = profile.getEvmAddress();
        return evmAddress !== undefined && this.isSuspended(evmAddress);
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
                !profile.isBlackListed &&
                !this.isProfileSuspended(profile)
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
}

export default ProfileManager;
