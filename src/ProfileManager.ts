import ATransport from "./transport/ATransport";
import PeerProfile from "./PeerProfile";

class ProfileManager {
    private mapTransportToProfile: WeakMap<ATransport, PeerProfile> =
        new WeakMap<ATransport, PeerProfile>();
    private mapEvmAddressToProfile: Map<string, PeerProfile> = new Map<
        string,
        PeerProfile
    >();
    private mapHpAddressToProfile: Map<string, PeerProfile> = new Map<
        string,
        PeerProfile
    >();

    public registerProfile(profile: PeerProfile) {
        this.mapTransportToProfile.set(profile.getTransport(), profile);
        let evmAddress = profile.getEvmAddress();
        if (evmAddress)
            this.mapEvmAddressToProfile.set(evmAddress.toString(), profile);
        let hpAddress = profile.getHpAddress();
        if (hpAddress) {
            this.mapHpAddressToProfile.set(hpAddress, profile);
        }
    }
    public unregisterProfile(profile: PeerProfile) {
        this.mapTransportToProfile.delete(profile.getTransport());
        let evmAddress = profile.getEvmAddress();
        if (evmAddress)
            this.mapEvmAddressToProfile.delete(evmAddress.toString());
        let hpAddress = profile.getHpAddress();
        if (hpAddress) this.mapHpAddressToProfile.delete(hpAddress);
    }
    public getProfileByTransport(
        transport: ATransport
    ): PeerProfile | undefined {
        return this.mapTransportToProfile.get(transport);
    }
    public getProfileByEvmAddress(evmAddress: string): PeerProfile | undefined {
        return this.mapEvmAddressToProfile.get(evmAddress);
    }
    public getProfileByHpAddress(hpAddress: string): PeerProfile | undefined {
        return this.mapHpAddressToProfile.get(hpAddress);
    }
}

export default ProfileManager;
