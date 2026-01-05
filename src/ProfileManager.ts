import { ATransport } from "@/transport";
import PeerProfile from "@/PeerProfile";
import { Address } from "./types/types";
import { ethers } from "ethers";

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
                transport.peerAddress = ethers.getAddress(
                    evmAddress.toString()
                );
            }
        }
        if (evmAddress)
            this.mapEvmAddressToProfile.set(
                ethers.getAddress(evmAddress.toString()),
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
            this.mapEvmAddressToProfile.delete(
                ethers.getAddress(evmAddress.toString())
            );
        const hpAddress = profile.getHpAddress();
        if (hpAddress) this.mapHpAddressToProfile.delete(hpAddress);
    }
    public updateTransport(profileAddress: string, newTransport: ATransport) {
        const profile = this.mapEvmAddressToProfile.get(
            ethers.getAddress(profileAddress)
        );
        if (!profile) return;
        const oldTransport = profile.getTransport();
        if (oldTransport) {
            setTimeout(() => {
                // allow agreementTime for everyone to update transport and start using new one, before closing this one
                this.removeTransport(oldTransport);
            }, oldTransport.p2pManager.stateManager.timeConfig.agreementTime * 1000);
        }

        // Ensure the new transport carries the peer identity.
        newTransport.peerAddress = ethers.getAddress(profileAddress);

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
        return this.mapEvmAddressToProfile.get(
            ethers.getAddress(evmAddress.toString())
        );
    }
    public getProfileByHpAddress(hpAddress: Address): PeerProfile | undefined {
        return this.mapHpAddressToProfile.get(hpAddress);
    }

    public getTransportByEvmAddress(evmAddress: Address): ATransport | null {
        return this.getProfileByEvmAddress(evmAddress)?.getTransport() ?? null;
    }
}

export default ProfileManager;
