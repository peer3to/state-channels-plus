import { ATransport, TransportType } from "@/transport";
import PeerProfile from "@/PeerProfile";
import { Address } from "./types/types";
import { getChecksumAddress } from "./utils";
import { LoggerUtils } from "./utils/LoggerUtils";

/**
 * Single owner of Holepunch ban/unban policy. No other transport or RPC code
 * may call `peerInfo.ban()` directly - callers ask `ProfileManager` to apply
 * policy for an identity and it invokes the transport-specific behaviour.
 *
 * Three cases are covered:
 * 1. Explicit blacklist (`blacklistProfile`) - ban forever.
 * 2. A Holepunch->WebRTC upgrade succeeds (`updateTransport`) - temporarily
 *    ban Holepunch so Hyperswarm doesn't reconnect the relay transport while
 *    WebRTC is healthy.
 * 3. The WebRTC transport closes (`releaseHolepunchBanOnWebRtcClose`) - unban
 *    Holepunch so it can reconnect as the fallback transport, unless the
 *    peer is explicitly blacklisted (case 1 wins and stays banned).
 */
class ProfileManager {
    private mapTransportToProfile: WeakMap<ATransport, PeerProfile> =
        new WeakMap<ATransport, PeerProfile>();
    private mapEvmAddressToProfile: Map<string, PeerProfile> = new Map();
    private mapHpAddressToProfile: Map<Address, PeerProfile> = new Map<
        Address,
        PeerProfile
    >();

    public registerProfile(profile: PeerProfile) {
        const evmAddress = profile.getEvmAddress();
        const transport = profile.getTransport();
        if (transport) {
            this.mapTransportToProfile.set(transport, profile);
            if (evmAddress && !transport.peerAddress) {
                transport.peerAddress = getChecksumAddress(evmAddress);
            }
            this.trackBannablePeerInfo(transport, profile);
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
    public unregisterProfile(profile: PeerProfile) {
        const transport = profile.getTransport();
        if (transport) this.mapTransportToProfile.delete(transport);
        const evmAddress = profile.getEvmAddress();
        if (evmAddress)
            this.mapEvmAddressToProfile.delete(getChecksumAddress(evmAddress));
        const hpAddress = profile.getHpAddress();
        if (hpAddress) this.mapHpAddressToProfile.delete(hpAddress);
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
                    this.removeTransport(oldTransport, true);
                },
                stateManager.timeConfig.agreementTime * 1000,
                "transport upgrade grace period elapsed – retiring old transport"
            );
        }

        // Ensure the new transport carries the peer identity.
        newTransport.peerAddress = getChecksumAddress(profileAddress);

        profile.setTransport(newTransport);
        this.mapTransportToProfile.set(newTransport, profile);
        this.trackBannablePeerInfo(newTransport, profile);
    }
    public removeTransport(transport: ATransport, isUpgraded = false) {
        const profile = this.mapTransportToProfile.get(transport);
        if (!profile) return;
        this.mapTransportToProfile.delete(transport);
        transport.close(isUpgraded);
    }
    public getProfileByTransport(
        transport: ATransport
    ): PeerProfile | undefined {
        const existingProfile = this.mapTransportToProfile.get(transport);
        if (existingProfile) {
            return existingProfile;
        }

        for (const profile of this.mapEvmAddressToProfile.values()) {
            if (profile.getTransport() === transport) {
                this.mapTransportToProfile.set(transport, profile);
                return profile;
            }
        }

        return undefined;
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
        return this.getProfileByEvmAddress(evmAddress)?.getTransport() ?? null;
    }

    /**
     * Case 1: explicit blacklist. Bans the Holepunch peer and never unbans
     * it - `releaseHolepunchBanOnWebRtcClose` checks `isBlackListed` and
     * refuses to lift a ban applied here.
     */
    public blacklistProfile(profile: PeerProfile): void {
        profile.blacklist();
        profile.getHolepunchPeerInfo()?.ban(true);
    }

    /**
     * Case 3 (release): the WebRTC transport for this profile closed. Unban
     * the stored Holepunch peer-info so Holepunch can reconnect as the
     * fallback transport - unless the profile is explicitly blacklisted, in
     * which case the ban from `blacklistProfile` stays in place.
     *
     * Note: Hyperswarm doesn't schedule a retry timer for a banned peer, so
     * lifting the ban doesn't by itself force an immediate outbound retry -
     * rediscovery/announce or `swarm.joinPeer(publicKey)` is what triggers
     * the next outbound attempt. Inbound connections are accepted again
     * right away.
     */
    public releaseHolepunchBanOnWebRtcClose(transport: ATransport): void {
        if (transport.transportType !== TransportType.WEBRTC) return;
        const profile = this.getProfileByTransport(transport);
        if (!profile || profile.isBlackListed) return;
        profile.getHolepunchPeerInfo()?.ban(false);
    }

    /**
     * Case 2: a Holepunch->WebRTC upgrade succeeded. Temporarily ban the
     * Holepunch peer so Hyperswarm doesn't reconnect the relay transport
     * while the preferred WebRTC transport is healthy. Lifted again by
     * `releaseHolepunchBanOnWebRtcClose` once the WebRTC transport closes.
     */
    private applyUpgradeBanPolicy(
        oldTransport: ATransport,
        newTransport: ATransport,
        profile: PeerProfile
    ): void {
        if (
            oldTransport.transportType !== TransportType.HOLEPUNCH ||
            newTransport.transportType !== TransportType.WEBRTC
        ) {
            return;
        }
        profile.getHolepunchPeerInfo()?.ban(true);
    }

    // Captures the Holepunch peer-info handle for `profile` whenever
    // `transport` exposes one, so the profile keeps it even after its active
    // transport moves on to WebRTC (transports that aren't Holepunch return
    // `undefined` and leave any previously stored handle untouched).
    private trackBannablePeerInfo(
        transport: ATransport,
        profile: PeerProfile
    ): void {
        const bannablePeerInfo = transport.getBannablePeerInfo();
        if (bannablePeerInfo) {
            profile.setHolepunchPeerInfo(bannablePeerInfo);
        }
    }
}

export default ProfileManager;
