import { ATransport } from "@/transport";
import PeerProfile from "@/PeerProfile";

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
        let transport = profile.getTransport();
        if (transport) this.mapTransportToProfile.set(transport, profile);
        let evmAddress = profile.getEvmAddress();
        if (evmAddress)
            this.mapEvmAddressToProfile.set(evmAddress.toString(), profile);
        let hpAddress = profile.getHpAddress();
        if (hpAddress) {
            this.mapHpAddressToProfile.set(hpAddress, profile);
        }
    }
    public unregisterProfile(profile: PeerProfile) {
        let transport = profile.getTransport();
        if (transport) this.mapTransportToProfile.delete(transport);
        let evmAddress = profile.getEvmAddress();
        if (evmAddress)
            this.mapEvmAddressToProfile.delete(evmAddress.toString());
        let hpAddress = profile.getHpAddress();
        if (hpAddress) this.mapHpAddressToProfile.delete(hpAddress);
    }
    public updateTransport(profileAddress: string, newTransport: ATransport) {
        let profile = this.mapEvmAddressToProfile.get(profileAddress);
        if (!profile) return;
        let oldTransport = profile.getTransport();
        if (oldTransport) this.removeTransport(oldTransport);
        profile.setTransport(newTransport);
        this.mapTransportToProfile.set(newTransport, profile);
    }
    public removeTransport(transport: ATransport) {
        let profile = this.mapTransportToProfile.get(transport);
        if (!profile) return;
        this.mapTransportToProfile.delete(transport);
        transport.close();
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
