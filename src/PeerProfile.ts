import type ATransport from "@/transport/ATransport";
import { Address } from "@/types/types";
import { LoggerUtils } from "@/utils/LoggerUtils";
import type { Logger } from "@/utils/logging/Logger";

export interface BannablePeerInfo {
    ban(value?: boolean): void;
}

export type ProfileDisconnectedListener = (
    profile: PeerProfile,
    finalTransport: ATransport
) => void;

//TODO? maybe rename to ParticipantProfile to be consistent with the rest of the codebase, even though PeerProfile sounds better
class PeerProfile {
    private readonly logger: Logger;
    transport: ATransport | undefined;
    evmAddress: Address | undefined; //TODO! - AAdress -> base class for different address types (when we do substrate and other address formats)
    hpAddress: string | undefined;
    isLeader: boolean;
    isBlackListed: boolean;
    // A reconnect ban keeps discovery from re-dialing or accepting this
    // identity without excluding it; a blacklist implies it.
    isReconnectBanned: boolean;
    private readonly liveTransports = new Set<ATransport>();
    private readonly disconnectedListeners =
        new Set<ProfileDisconnectedListener>();
    // This handle belongs to the profile before and after authentication.
    private holepunchPeerInfo: BannablePeerInfo | undefined;

    constructor(
        transport: ATransport,
        evmAddress?: Address,
        hpAddress?: string | undefined
    ) {
        this.logger = transport.p2pManager.logger.child({
            component: "PeerProfile"
        });
        this.transport = transport;
        this.liveTransports.add(transport);
        this.evmAddress = evmAddress;
        this.hpAddress = hpAddress;
        this.isLeader = false;
        this.isBlackListed = false;
        this.isReconnectBanned = false;
    }

    public blacklist() {
        this.logger.warn(
            "Blacklisting peer profile",
            LoggerUtils.getPeerProfileMetadata(this)
        );
        this.isBlackListed = true;
    }
    public unblacklist() {
        this.logger.info(
            "Clearing peer profile blacklist",
            LoggerUtils.getPeerProfileMetadata(this)
        );
        this.isBlackListed = false;
    }
    public banReconnect() {
        this.isReconnectBanned = true;
    }
    public allowReconnect() {
        this.isReconnectBanned = false;
    }
    public getTransport() {
        if (this.transport && !this.transport.isClosed) return this.transport;
        this.transport = this.findLiveTransport();
        return this.transport;
    }
    public attachTransport(transport: ATransport, preferred = true): void {
        if (!transport.isClosed) this.liveTransports.add(transport);
        if (preferred || !this.getTransport()) this.transport = transport;
        this.logger.debug("Attached peer transport", {
            ...LoggerUtils.getTransportMetadata(transport),
            preferred,
            remainingTransports: this.liveTransports.size
        });
    }
    public detachTransport(transport: ATransport): void {
        const wasLive = this.liveTransports.delete(transport);
        this.logger.debug("Detached peer transport", {
            ...LoggerUtils.getTransportMetadata(transport),
            wasLive,
            remainingTransports: this.liveTransports.size
        });
        if (!wasLive) return;
        if (this.transport === transport) {
            this.transport = this.findLiveTransport();
        }
        if (this.liveTransports.size !== 0) return;
        this.logger.info(
            "Peer profile lost its last transport",
            LoggerUtils.getPeerProfileMetadata(this)
        );
        for (const listener of [...this.disconnectedListeners]) {
            listener(this, transport);
        }
    }
    public hasLiveTransport(transport: ATransport): boolean {
        return this.liveTransports.has(transport) && !transport.isClosed;
    }
    public getLiveTransports(): ATransport[] {
        return [...this.liveTransports].filter(
            (transport) => !transport.isClosed
        );
    }
    public isPreferredTransport(transport: ATransport): boolean {
        return this.transport === transport;
    }
    public onDisconnected(listener: ProfileDisconnectedListener): () => void {
        this.disconnectedListeners.add(listener);
        return () => this.disconnectedListeners.delete(listener);
    }
    public absorbLifecycleFrom(profile: PeerProfile): void {
        for (const listener of profile.disconnectedListeners) {
            this.disconnectedListeners.add(listener);
        }
        profile.disconnectedListeners.clear();
        const peerInfo = profile.takeHolepunchPeerInfo();
        if (peerInfo) this.setHolepunchPeerInfo(peerInfo);
        if (profile.isBlackListed) this.blacklist();
        if (profile.isReconnectBanned) this.banReconnect();
        // The absorbed handle is the one this identity is reachable on now, so
        // a standing exclusion or suspension has to follow it. `allowReconnect`
        // then finds and lifts the ban on the handle that actually carries it.
        if (peerInfo && (this.isBlackListed || this.isReconnectBanned)) {
            peerInfo.ban(true);
        }
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
        this.logger.debug("Authenticated peer profile", {
            previousAddress: this.evmAddress,
            peerAddress: evmAddress
        });
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

    private findLiveTransport(): ATransport | undefined {
        for (const transport of this.liveTransports) {
            if (!transport.isClosed) return transport;
        }
        return undefined;
    }
}

export default PeerProfile;
