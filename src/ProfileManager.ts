import { Address } from "./types/types";
import { getChecksumAddress } from "./utils";
import { LoggerUtils } from "./utils/LoggerUtils";
import PeerProfile, { BannablePeerInfo } from "@/PeerProfile";
import ATransport from "@/transport/ATransport";
import { TransportType } from "@/transport/TransportType";

// ProfileManager alone owns explicit bans, upgrade bans, and fallback release.
// An explicit blacklist always wins over transport fallback.
class ProfileManager {
    private mapTransportToProfile: WeakMap<ATransport, PeerProfile> =
        new WeakMap<ATransport, PeerProfile>();
    private mapEvmAddressToProfile: Map<Address, PeerProfile> = new Map();
    private mapHpAddressToProfile: Map<Address, PeerProfile> = new Map<
        Address,
        PeerProfile
    >();

    public registerTransport(transport: ATransport): PeerProfile {
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
        transport: ATransport,
        evmAddress: Address
    ): PeerProfile | undefined {
        const normalizedAddress = getChecksumAddress(evmAddress);
        const existingProfile =
            this.mapEvmAddressToProfile.get(normalizedAddress);
        if (existingProfile) {
            if (existingProfile.isBlackListed) {
                transport.p2pManager.logger.warn(
                    "Rejecting transport for blacklisted profile",
                    {
                        ...LoggerUtils.getTransportMetadata(transport),
                        peerAddress: normalizedAddress
                    }
                );
                this.blacklistPeer(transport);
                transport.close(true);
                return undefined;
            }
            // A suspension placed after the handshake response was verified
            // still has to refuse here, the final admission boundary. It never
            // escalates to an exclusion: the identity is only suspended.
            if (existingProfile.isReconnectBanned) {
                transport.close(true);
                return undefined;
            }
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
        detachedTransport?: ATransport
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
    public updateTransport(profileAddress: string, newTransport: ATransport) {
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
    public removeTransport(transport: ATransport, isUpgraded = false) {
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
        transport: ATransport
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

    public getTransportByEvmAddress(evmAddress: Address): ATransport | null {
        const transport =
            this.getProfileByEvmAddress(evmAddress)?.getTransport() ?? null;
        return transport && !transport.isClosed ? transport : null;
    }

    public setBannablePeerInfo(
        transport: ATransport,
        peerInfo: BannablePeerInfo
    ): void {
        this.registerTransport(transport).setHolepunchPeerInfo(peerInfo);
    }

    public blacklistPeer(peer: ATransport | Address): ATransport | undefined {
        if (peer instanceof ATransport) {
            const profile = this.getProfileByTransport(peer);
            if (profile) this.blacklistProfile(profile);
            return peer;
        }

        const profile = this.getProfileByEvmAddress(peer);
        if (!profile) return undefined;
        this.blacklistProfile(profile);
        return profile.getTransport();
    }

    public unblacklistPeer(evmAddress: Address): boolean {
        const profile = this.getProfileByEvmAddress(evmAddress);
        if (!profile) return false;

        profile.unblacklist();
        // A live WebRTC route keeps the Holepunch handle banned: that ban
        // belongs to the upgrade policy, and its own close path releases it.
        if (this.hasLiveWebRtcTransport(profile)) return true;
        this.restoreHolepunchReachability(profile);
        return true;
    }

    /**
     * Ban reconnects from an identity without excluding it. Hyperswarm keeps
     * re-dialing a peer that shares an observed topic until its peer info is
     * banned; a plain close only pauses it. `allowReconnect` lifts the ban.
     */
    public banReconnect(evmAddress: Address): boolean {
        const profile = this.getProfileByEvmAddress(evmAddress);
        if (!profile) return false;
        profile.banReconnect();
        profile.getHolepunchPeerInfo()?.ban(true);
        return true;
    }

    public allowReconnect(evmAddress: Address): boolean {
        const profile = this.getProfileByEvmAddress(evmAddress);
        if (!profile) return false;
        profile.allowReconnect();
        // A live WebRTC route keeps the Holepunch handle banned: that ban
        // belongs to the upgrade policy, and its own close path releases it.
        if (this.hasLiveWebRtcTransport(profile)) return true;
        this.restoreHolepunchReachability(profile);
        return true;
    }

    public isReconnectBanned(evmAddress: Address): boolean {
        return (
            this.getProfileByEvmAddress(evmAddress)?.isReconnectBanned ?? false
        );
    }

    /**
     * Move the discovery handle a refused transport arrived on onto the
     * identity's own profile. A standing suspension then follows the handle the
     * identity is currently reachable on, so `allowReconnect` finds and lifts it
     * there instead of leaving a ban on an object nothing references again.
     */
    public adoptRefusedTransportHandle(
        transport: ATransport,
        evmAddress: Address
    ): void {
        const identityProfile = this.getProfileByEvmAddress(evmAddress);
        const transportProfile = this.mapTransportToProfile.get(transport);
        if (
            !identityProfile ||
            !transportProfile ||
            transportProfile === identityProfile
        ) {
            return;
        }
        identityProfile.absorbLifecycleFrom(transportProfile);
    }

    /** True while the identity holds a live transport other than this one. */
    public hasOtherLiveTransport(
        evmAddress: Address,
        transport: ATransport
    ): boolean {
        return (
            this.getProfileByEvmAddress(evmAddress)
                ?.getLiveTransports()
                .some((liveTransport) => liveTransport !== transport) ?? false
        );
    }

    /** Ban the discovery handle one transport arrived on. */
    public banTransportReconnect(transport: ATransport): void {
        this.getProfileByTransport(transport)
            ?.getHolepunchPeerInfo()
            ?.ban(true);
    }

    public releaseHolepunchBanOnWebRtcClose(transport: ATransport): void {
        if (transport.transportType !== TransportType.WEBRTC) return;
        const profile = this.getProfileByTransport(transport);
        if (!profile || !profile.isPreferredTransport(transport)) return;
        if (this.isDiscoveryBanHeld(profile)) return;
        transport.p2pManager.logger.debug(
            "Releasing Holepunch upgrade ban after WebRTC close",
            LoggerUtils.getTransportMetadata(transport)
        );
        this.restoreHolepunchReachability(profile);
    }

    private blacklistProfile(profile: PeerProfile): void {
        profile.blacklist();
        profile.getHolepunchPeerInfo()?.ban(true);
    }

    /**
     * Lift the discovery ban only while nothing keeps the identity out: not a
     * blacklist and not a reconnect ban.
     */
    private restoreHolepunchReachability(profile: PeerProfile): void {
        if (this.isDiscoveryBanHeld(profile)) return;
        profile.getHolepunchPeerInfo()?.ban(false);
    }

    /** True while a blacklist or a reconnect ban keeps the identity out. */
    private isDiscoveryBanHeld(profile: PeerProfile): boolean {
        return profile.isBlackListed || profile.isReconnectBanned;
    }

    private hasLiveWebRtcTransport(profile: PeerProfile): boolean {
        return profile
            .getLiveTransports()
            .some(
                (transport) => transport.transportType === TransportType.WEBRTC
            );
    }

    private applyUpgradeBanPolicy(
        oldTransport: ATransport,
        newTransport: ATransport,
        profile: PeerProfile
    ): void {
        if (
            oldTransport.transportType !== TransportType.HOLEPUNCH ||
            newTransport.transportType !== TransportType.WEBRTC
        ) {
            if (
                oldTransport.transportType === TransportType.WEBRTC &&
                newTransport.transportType === TransportType.HOLEPUNCH
            ) {
                this.restoreHolepunchReachability(profile);
            }
            return;
        }
        profile.getHolepunchPeerInfo()?.ban(true);
    }

    private attachTransportProfile(
        transport: ATransport,
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
