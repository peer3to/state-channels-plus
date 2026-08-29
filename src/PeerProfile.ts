import type ATransport from "@/transport/ATransport";
import { Address } from "@/types/types";

export interface BannablePeerInfo {
    ban(value?: boolean): void;
}

//TODO? maybe rename to ParticipantProfile to be consistent with the rest of the codebase, even though PeerProfile sounds better
class PeerProfile {
    transport: ATransport | undefined;
    evmAddress: Address | undefined; //TODO! - AAdress -> base class for different address types (when we do substrate and other address formats)
    hpAddress: string | undefined;
    isLeader: boolean;
    isBlackListed: boolean;
    // This handle belongs to the profile before and after authentication.
    private holepunchPeerInfo: BannablePeerInfo | undefined;
    constructor(
        transport: ATransport,
        evmAddress?: Address,
        hpAddress?: string | undefined
    ) {
        this.transport = transport;
        this.evmAddress = evmAddress;
        this.hpAddress = hpAddress;
        this.isLeader = false;
        this.isBlackListed = false;
    }

    public blacklist() {
        this.isBlackListed = true;
    }
    public unblacklist() {
        this.isBlackListed = false;
    }
    public getTransport() {
        return this.transport;
    }
    public setTransport(transport: ATransport) {
        this.transport = transport;
    }
    public removeTransport() {
        this.transport = undefined;
    }
    public setHolepunchPeerInfo(peerInfo: BannablePeerInfo) {
        this.holepunchPeerInfo = peerInfo;
    }
    public removeHolepunchPeerInfo() {
        this.holepunchPeerInfo = undefined;
    }
    public takeHolepunchPeerInfo(): BannablePeerInfo | undefined {
        const peerInfo = this.holepunchPeerInfo;
        this.holepunchPeerInfo = undefined;
        return peerInfo;
    }
    public getHolepunchPeerInfo(): BannablePeerInfo | undefined {
        return this.holepunchPeerInfo;
    }
    public getEvmAddress() {
        return this.evmAddress;
    }
    public setEvmAddress(evmAddress: Address) {
        this.evmAddress = evmAddress;
    }
    public getHpAddress() {
        return this.hpAddress;
    }
    public setIsLeader(value: boolean) {
        this.isLeader = value;
    }
    public getIsLeader() {
        return this.isLeader;
    }
}

export default PeerProfile;
