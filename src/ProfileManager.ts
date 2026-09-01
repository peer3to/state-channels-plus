import ATransport from "@/transport/ATransport";
import { TransportType } from "@/transport/TransportType";
import PeerProfile, { BannablePeerInfo } from "@/PeerProfile";
import { Address } from "./types/types";
import { getChecksumAddress } from "./utils";
import { LoggerUtils } from "./utils/LoggerUtils";

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
                this.blacklistPeer(transport);
                transport.close(true);
                return undefined;
            }
            const currentTransport = existingProfile.getTransport();
            if (
                currentTransport?.transportType === TransportType.WEBRTC &&
                !currentTransport.isClosed &&
                transport.transportType === TransportType.HOLEPUNCH
            ) {
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

    public releaseHolepunchBanOnWebRtcClose(transport: ATransport): void {
        if (transport.transportType !== TransportType.WEBRTC) return;
        const profile = this.getProfileByTransport(transport);
        if (
            !profile ||
            !profile.isPreferredTransport(transport) ||
            profile.isBlackListed
        ) {
            return;
        }
        profile.getHolepunchPeerInfo()?.ban(false);
    }

    private blacklistProfile(profile: PeerProfile): void {
        profile.blacklist();
        profile.getHolepunchPeerInfo()?.ban(true);
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
                newTransport.transportType === TransportType.HOLEPUNCH &&
                !profile.isBlackListed
            ) {
                profile.getHolepunchPeerInfo()?.ban(false);
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
