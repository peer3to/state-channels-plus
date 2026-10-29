import {
    createWebRTCConnectionFactory,
    type WebRTCConnectionCallbacks,
    type WebRTCConnectionFactory,
    type WebRTCConnectionStateSnapshot,
    type WebRTCPeerAddress
} from "./connection/WebRTCConnectionFactory";
import type {
    WebRTCConnectionStateName,
    WebRTCIceStateName
} from "./connection/WebRTCConnectionTypes";
import WebRTCSetupRpcMethods from "./WebRTCSetupRpcMethods";
import type P2PManager from "@/P2PManager";
import ANetworkRpcService from "@/rpc/network/ANetworkRpcService";
import { HandshakeCompletedGuard } from "@/rpc/network/guards";
import { NetworkTransport } from "@/transport";
import WebRTCTransport from "@/transport/WebRTCTransport";
import { getChecksumAddress } from "@/utils";

/**
 * How long a connection whose network path stopped answering may take to
 * recover by itself before its transport closes. Chrome reports
 * `disconnected` after about 2-3 s without connectivity-check answers, and
 * `failed` only after about 30 s.
 */
const DISCONNECTED_GRACE_MS = 5_000;

/** States after which a connection never recovers. */
const FINAL_STATES: ReadonlySet<
    WebRTCConnectionStateName | WebRTCIceStateName
> = new Set(["failed", "closed"]);

/** ICE states of a working network path. */
const RECOVERED_ICE_STATES: ReadonlySet<WebRTCIceStateName> = new Set([
    "connected",
    "completed"
]);

/** Milliseconds since the Unix epoch. */
type EpochMs = number;

/** One connection: its transport, its last reported state, and its current `disconnected` episode. */
type ConnectionWatch = {
    transport?: WebRTCTransport;
    lastState?: WebRTCConnectionStateSnapshot;
    disconnectedAt?: EpochMs;
    graceTask?: ReturnType<typeof setTimeout>;
};

class WebRTCSetupService extends ANetworkRpcService<WebRTCSetupRpcMethods> {
    private connectionFactory?: WebRTCConnectionFactory;
    /** Each peer's current connection; the factory holds one per peer. */
    private readonly currentWatches = new Map<
        WebRTCPeerAddress,
        ConnectionWatch
    >();

    constructor(p2pManager: P2PManager) {
        super(
            p2pManager.rpcRouter,
            p2pManager.stateManager.logger.child({
                module: "WebRTCSetupService"
            })
        );
        this.guards = [new HandshakeCompletedGuard(this)];
    }

    public createRPCMethods(
        transport: NetworkTransport
    ): WebRTCSetupRpcMethods {
        return new WebRTCSetupRpcMethods(transport, this);
    }

    public setConnectionFactory(factory: WebRTCConnectionFactory): void {
        this.connectionFactory = factory;
    }

    public getWebRTCConnectionState(
        peerAddress: WebRTCPeerAddress
    ): WebRTCConnectionStateSnapshot {
        const normalizedPeerAddress = this.normalizePeerAddress(peerAddress);
        return (
            this.connectionFactory?.getState(normalizedPeerAddress) || {
                connectionState: "unknown",
                iceState: "unknown"
            }
        );
    }

    /**
     * Closes the connection of `transport` when it is still its peer's
     * current one. A replaced connection is already closed, and closing by
     * peer would close the peer's newer connection.
     */
    public closeWebRTCConnection(transport: WebRTCTransport): void {
        for (const [peerAddress, watch] of this.currentWatches) {
            if (watch.transport !== transport) continue;
            this.closeConnection(peerAddress, watch);
            return;
        }
    }

    public async acceptWebRTCOffer(
        peerAddress: WebRTCPeerAddress,
        offer: any
    ): Promise<any> {
        const normalizedPeerAddress = this.normalizePeerAddress(peerAddress);
        const factory = await this.getConnectionFactory();
        return factory.acceptOffer(
            normalizedPeerAddress,
            offer,
            this.createConnectionCallbacks(normalizedPeerAddress)
        );
    }

    public async applyWebRTCAnswer(
        peerAddress: WebRTCPeerAddress,
        answer: any
    ): Promise<void> {
        const normalizedPeerAddress = this.normalizePeerAddress(peerAddress);
        const factory = await this.getConnectionFactory();
        await factory.applyAnswer(normalizedPeerAddress, answer);
    }

    public async addWebRTCIceCandidate(
        peerAddress: WebRTCPeerAddress,
        candidate: any
    ): Promise<void> {
        const normalizedPeerAddress = this.normalizePeerAddress(peerAddress);
        const factory = await this.getConnectionFactory();
        await factory.addIceCandidate(normalizedPeerAddress, candidate);
    }

    //Ran by the peer who is initiating the connection - this creates the offer
    public async initiateWebRTC(transport: NetworkTransport) {
        try {
            this.logger.debug("initiateWebRTC");
            const profileManager = this.p2pManager.profileManager;
            let adr =
                profileManager.getProfileByTransport(transport)?.evmAddress;
            if (!adr) {
                this.logger.error("initiateWebRTC - no EVM address");
                return;
            }
            adr = getChecksumAddress(adr);

            const factory = await this.getConnectionFactory();
            const offer = await factory.createOffer(
                adr,
                this.createConnectionCallbacks(adr)
            );
            const serializedOffer = JSON.stringify(offer);
            this.remoteRpc.webRTCSetupService
                .onOfferWebRTC(serializedOffer)
                .sendOne(adr);
        } catch (e) {
            this.logger.error("initiateWebRTC - error", e);
        }
    }

    private normalizePeerAddress(
        peerAddress: WebRTCPeerAddress
    ): WebRTCPeerAddress {
        return getChecksumAddress(peerAddress) as WebRTCPeerAddress;
    }

    private async getConnectionFactory(): Promise<WebRTCConnectionFactory> {
        if (!this.connectionFactory) {
            this.connectionFactory = await createWebRTCConnectionFactory();
        }
        return this.connectionFactory;
    }

    private serializeAndSendIceCandidate(
        peerAddress: WebRTCPeerAddress,
        candidate: any
    ): void {
        const serializedCandidate = JSON.stringify(candidate);
        this.remoteRpc.webRTCSetupService
            .onIceCandidate(serializedCandidate)
            .sendOne(peerAddress);
    }

    /**
     * The network path (ICE state) decides: `disconnected` means the path
     * stopped answering, and it keeps being checked, so the connection's
     * transport stays open for DISCONNECTED_GRACE_MS and closes only if the
     * path is still down then. `connected` or `completed` ends the grace. In
     * Node (werift) `connectionState` stays `disconnected` after the path
     * recovers, so it cannot end the grace. `failed` or `closed` in either
     * state, a DTLS failure included, closes the transport at once.
     */
    private handleConnectionStateChange(
        peerAddress: WebRTCPeerAddress,
        watch: ConnectionWatch,
        state: WebRTCConnectionStateSnapshot
    ): void {
        const timeoutManager = this.p2pManager.stateManager.timeoutManager;
        const disconnectedMs =
            watch.disconnectedAt === undefined
                ? undefined
                : Date.now() - watch.disconnectedAt;
        const details = { peerAddress, ...state, disconnectedMs };
        watch.lastState = state;
        if (
            FINAL_STATES.has(state.connectionState) ||
            FINAL_STATES.has(state.iceState)
        ) {
            this.logger.warn(
                "WebRTC connection ended; closing its transport",
                details
            );
            if (watch.graceTask) timeoutManager.cancelTask(watch.graceTask);
            watch.graceTask = undefined;
            // The transport's close closes its connection; without one
            // yet, the connection closes here.
            if (watch.transport) watch.transport.close();
            else this.closeConnection(peerAddress, watch);
            return;
        }
        if (state.iceState === "disconnected" && !watch.disconnectedAt) {
            watch.disconnectedAt = Date.now();
            this.logger.warn(
                "WebRTC connection disconnected; waiting for it to recover",
                { ...details, graceMs: DISCONNECTED_GRACE_MS }
            );
            watch.graceTask = timeoutManager.scheduleTask(
                () => {
                    if (!watch.transport) {
                        // No transport to close yet: the next loss starts a new grace.
                        watch.disconnectedAt = undefined;
                        watch.graceTask = undefined;
                        return;
                    }
                    if (watch.transport.isClosed) return;
                    this.logger.warn(
                        "WebRTC connection did not recover; closing its transport",
                        {
                            peerAddress,
                            ...watch.lastState,
                            disconnectedMs: Date.now() - watch.disconnectedAt!
                        }
                    );
                    watch.transport.close();
                },
                DISCONNECTED_GRACE_MS,
                "WebRTC disconnected grace elapsed"
            );
            return;
        }
        if (RECOVERED_ICE_STATES.has(state.iceState) && watch.disconnectedAt) {
            if (watch.graceTask) timeoutManager.cancelTask(watch.graceTask);
            watch.graceTask = undefined;
            watch.disconnectedAt = undefined;
            this.logger.info("WebRTC connection recovered", details);
            return;
        }
        this.logger.info("WebRTC connection state changed", details);
    }

    private createConnectionCallbacks(
        peerAddress: WebRTCPeerAddress
    ): WebRTCConnectionCallbacks {
        // The factory closes the peer's previous connection, so its
        // transport is dead: close it now, which also ends its grace.
        const previous = this.currentWatches.get(peerAddress);
        const watch: ConnectionWatch = {};
        this.currentWatches.set(peerAddress, watch);
        previous?.transport?.close();
        return {
            onIceCandidate: (candidate) => {
                this.serializeAndSendIceCandidate(peerAddress, candidate);
            },
            onDataChannel: (channel) => {
                watch.transport = new WebRTCTransport(
                    channel,
                    this.p2pManager.rpcRouter
                );
            },
            onConnectionStateChange: (state) => {
                this.handleConnectionStateChange(peerAddress, watch, state);
            },
            onError: (error) => {
                this.logger.error("WebRTC connection factory error", error);
            }
        };
    }

    /**
     * Forgets `watch`, the peer's current connection, and closes that
     * connection in the factory. A failed close is not caught: it escapes
     * as an unhandled rejection, which is fatal.
     */
    private closeConnection(
        peerAddress: WebRTCPeerAddress,
        watch: ConnectionWatch
    ): void {
        if (this.currentWatches.get(peerAddress) !== watch) return;
        this.currentWatches.delete(peerAddress);
        void this.connectionFactory?.close(peerAddress);
    }
}

export default WebRTCSetupService;
