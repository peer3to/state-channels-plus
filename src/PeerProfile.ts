import { ATransport, BannablePeerInfo } from "@/transport";
import { Address } from "@/types/types";

//TODO? maybe rename to ParticipantProfile to be consistent with the rest of the codebase, even though PeerProfile sounds better
class PeerProfile {
    transport: ATransport | undefined;
    evmAddress: Address; //TODO! - AAdress -> base class for different address types (when we do substrate and other address formats)
    hpAddress: string | undefined;
    isLeader: boolean;
    isBlackListed: boolean;
    // The Holepunch peer-info handle for this identity, kept even after the
    // active transport is upgraded to WebRTC so `ProfileManager` can still
    // apply ban policy (upgrade ban / fallback release) once Holepunch is no
    // longer the active transport.
    private holepunchPeerInfo: BannablePeerInfo | undefined;
    private isHandshakeCompleted = false;
    constructor(
        transport: ATransport,
        evmAddress: Address,
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
    public getHolepunchPeerInfo(): BannablePeerInfo | undefined {
        return this.holepunchPeerInfo;
    }
    public getEvmAddress() {
        return this.evmAddress;
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
    public setIsHandshakeCompleted(value: boolean) {
        this.isHandshakeCompleted = value;
    }
    public getIsHandshakeCompleted() {
        return this.isHandshakeCompleted;
    }
}

export default PeerProfile;
