import { ATransport } from "@/transport";
import PeerProfile from "@/PeerProfile";
import { Address } from "./types/types";

class ProfileManager {
    private mapTransportToProfile: WeakMap<ATransport, PeerProfile> =
        new WeakMap<ATransport, PeerProfile>();
    private mapEvmAddressToProfile: Map<Address, PeerProfile> = new Map<
        Address,
        PeerProfile
    >();
    private mapHpAddressToProfile: Map<Address, PeerProfile> = new Map<
        Address,
        PeerProfile
    >();

    public registerProfile(profile: PeerProfile) {
        const transport = profile.getTransport();
        if (transport) this.mapTransportToProfile.set(transport, profile);
        const evmAddress = profile.getEvmAddress();
        if (evmAddress) this.mapEvmAddressToProfile.set(evmAddress, profile);
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
            this.mapEvmAddressToProfile.delete(evmAddress.toString());
        const hpAddress = profile.getHpAddress();
        if (hpAddress) this.mapHpAddressToProfile.delete(hpAddress);
    }
    public updateTransport(profileAddress: string, newTransport: ATransport) {
        const profile = this.mapEvmAddressToProfile.get(profileAddress);
        if (!profile) return;
        const oldTransport = profile.getTransport();
        if (oldTransport) this.removeTransport(oldTransport);
        profile.setTransport(newTransport);
        this.mapTransportToProfile.set(newTransport, profile);
    }
    public removeTransport(transport: ATransport) {
        const profile = this.mapTransportToProfile.get(transport);
        if (!profile) return;
        this.mapTransportToProfile.delete(transport);
        transport.close();
    }
    public getProfileByTransport(
        transport: ATransport
    ): PeerProfile | undefined {
        return this.mapTransportToProfile.get(transport);
    }
    public getProfileByEvmAddress(
        evmAddress: Address
    ): PeerProfile | undefined {
        return this.mapEvmAddressToProfile.get(evmAddress);
    }
    public getProfileByHpAddress(hpAddress: Address): PeerProfile | undefined {
        return this.mapHpAddressToProfile.get(hpAddress);
    }
}

export default ProfileManager;
