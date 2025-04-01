import { AddressLike } from "ethers";
import { ATransport } from "@/transport";

//TODO? maybe rename to ParticipantProfile to be consistent with the rest of the codebase, eventhough PeerProfile sounds better
class PeerProfile {
    transport: ATransport | undefined;
    evmAddress: AddressLike; //TODO! - AAdress -> base class for different address types (when we do substrate and other address formats)
    hpAddress: string | undefined;
    isLeader: boolean;
    isBlackListed: boolean;
    isHandshakeCompleted = false;
    constructor(
        transport: ATransport,
        evmAddress: AddressLike,
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
