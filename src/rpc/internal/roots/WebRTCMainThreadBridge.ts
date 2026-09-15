import LocalWebRTCConnectionFactory from "../../network/services/WebRTCSetup/connection/LocalWebRTCConnectionFactory";
import type { RootStartContext } from "../createRoot";
import { createRoot } from "../createRoot";
import type { WebRTCWorkerBridgeRoot } from "./WebRTCWorkerBridgeRoot";
import type {
    WebRTCConnectionCallbacks,
    WebRTCDataChannelLike,
    WebRTCPeerAddress
} from "../../network/services/WebRTCSetup/connection/WebRTCConnectionTypes";
import { loadWebRTCProvider } from "../../network/services/WebRTCSetup/connection/WebRTCProvider";
import { serializeError } from "../errorWire";
import { WebRTCNegotiationService } from "../services/webRTCNegotiation/WebRTCNegotiationService";
import {
    AInternalRpcRoot,
    type RuntimeConnection
} from "@/rpc/internal/AInternalRpcRoot";
import type { Logger } from "@/utils/logging/Logger";
import { adaptPort } from "@platform/p2pRuntimeChannel";

export type WebRTCChannelMode = "auto" | "transfer" | "proxy";

export type WebRTCMainThreadBridgeOptions = {
    /**
     * How a freshly-created RTCDataChannel is handed to the worker:
     *  - "auto" (default): attempt to transfer the channel to the worker and,
     *    if the runtime can't transfer it, fall back to proxying its messages
     *    over the bridge.
     *  - "transfer": only transfer; throw if the runtime can't (strict).
     *  - "proxy": always proxy — use when transfer is known-unsupported
     *    (e.g. Firefox/Safari) or in tests.
     */
    channelMode?: WebRTCChannelMode;
    /**
     * Logger for bridge diagnostics on the main thread. Pass the logger
     * returned by `p2pSetup` so notices reach the SDK log pipeline instead of
     * the console.
     */
    logger?: Logger;
};

export type WebRTCMainThreadBridgeHandle = {
    dispose(): void;
};

type ConnectionRecord = {
    proxiedChannel?: WebRTCDataChannelLike;
};

export class WebRTCMainThreadBridgeRoot extends AInternalRpcRoot<WebRTCWorkerBridgeRoot> {
    public readonly negotiation: WebRTCNegotiationService;
    private factory!: LocalWebRTCConnectionFactory;
    // Cached the first time "auto" mode attempts a transfer: once we learn the
    // runtime can't transfer channels we go straight to proxy for the rest.
    private channelTransferSupported?: boolean;
    private readonly connectionsByPeerAddress = new Map<
        WebRTCPeerAddress,
        ConnectionRecord
    >();

    constructor(
        private readonly options: WebRTCMainThreadBridgeOptions = {},
        _local: undefined,
        context: RootStartContext
    ) {
        super(
            (error) => {
                throw error;
            },
            30_000,
            context
        );
        this.negotiation = new WebRTCNegotiationService(this.router, this);
    }

    public async start(): Promise<void> {
        this.factory = new LocalWebRTCConnectionFactory(
            await loadWebRTCProvider()
        );
    }

    private get remote(): RuntimeConnection<WebRTCWorkerBridgeRoot> {
        if (!this.parent)
            throw new Error("WebRTC bridge requires a configured recipient");
        return this.parent.rpc;
    }

    // Implements root cleanup through the shared recursive disposal contract.
    public override dispose(): Promise<void> {
        return this.disposeRoot(() => this.closePeerConnections());
    }

    private async closePeerConnections(): Promise<void> {
        await Promise.all(
            [...this.connectionsByPeerAddress.keys()].map((peer) =>
                this.close(peer)
            )
        );
    }

    public proxySend(peerAddress: WebRTCPeerAddress, data: unknown): void {
        this.connectionsByPeerAddress
            .get(peerAddress)
            ?.proxiedChannel?.send(data);
    }

    public proxyClose(peerAddress: WebRTCPeerAddress): void {
        this.connectionsByPeerAddress.get(peerAddress)?.proxiedChannel?.close();
    }

    private async callbacks(
        peerAddress: WebRTCPeerAddress,
        asynchronousChannel: boolean
    ): Promise<WebRTCConnectionCallbacks> {
        // Validate the callback recipient before allocating a native connection.
        const remote = this.remote;
        await this.close(peerAddress);
        const record: ConnectionRecord = {};
        this.connectionsByPeerAddress.set(peerAddress, record);
        return {
            onError: (error) =>
                remote.webRTCBridge
                    .error(peerAddress, serializeError(error))
                    .send(),
            onConnectionStateChange: (state) =>
                remote.webRTCBridge.state(peerAddress, state).send(),
            onIceCandidate: (candidate) =>
                remote.webRTCBridge.iceCandidate(peerAddress, candidate).send(),
            onDataChannel: (channel) => {
                try {
                    this.postChannel(peerAddress, record, channel);
                } catch (error) {
                    void this.close(peerAddress);
                    if (!asynchronousChannel) throw error;
                    remote.webRTCBridge
                        .error(peerAddress, serializeError(error))
                        .send();
                }
            }
        };
    }

    public async createOffer(peerAddress: WebRTCPeerAddress): Promise<any> {
        return this.factory.createOffer(
            peerAddress,
            await this.callbacks(peerAddress, false)
        );
    }

    public async acceptOffer(
        peerAddress: WebRTCPeerAddress,
        offer: any
    ): Promise<any> {
        return this.factory.acceptOffer(
            peerAddress,
            offer,
            await this.callbacks(peerAddress, true)
        );
    }

    public applyAnswer(
        peerAddress: WebRTCPeerAddress,
        answer: any
    ): Promise<void> {
        return this.factory.applyAnswer(peerAddress, answer);
    }

    public addIceCandidate(
        peerAddress: WebRTCPeerAddress,
        candidate: any
    ): Promise<void> {
        return this.factory.addIceCandidate(peerAddress, candidate);
    }

    public async close(peerAddress: WebRTCPeerAddress): Promise<void> {
        const record = this.connectionsByPeerAddress.get(peerAddress);
        if (!record) return;
        this.connectionsByPeerAddress.delete(peerAddress);
        record.proxiedChannel?.close();
        await this.factory.close(peerAddress);
    }

    private postChannel(
        peerAddress: WebRTCPeerAddress,
        record: ConnectionRecord,
        channel: WebRTCDataChannelLike
    ): void {
        if (this.shouldProxyChannel()) {
            this.postProxyChannel(peerAddress, record, channel);
            return;
        }

        try {
            this.remote.webRTCBridge
                // Transfer ownership of the live data channel, which JSON cannot encode.
                .transferredChannel(peerAddress, channel)
                .send({ transfer: [channel] });
            this.channelTransferSupported = true;
            return;
        } catch (error) {
            this.channelTransferSupported = false;
            if ((this.options.channelMode ?? "auto") === "transfer") {
                throw error;
            }
            // Surface the reason once (subsequent channels skip the attempt via
            // shouldProxyChannel) so a transfer-unsupported runtime is visible
            // rather than silently degrading.
            this.rootLogger.warn(
                "[peer3:webrtc-bridge] RTCDataChannel transfer is unsupported in this runtime; " +
                    "falling back to proxying channel messages over the bridge.",
                error
            );
        }

        this.postProxyChannel(peerAddress, record, channel);
    }

    private shouldProxyChannel(): boolean {
        const channelMode = this.options.channelMode ?? "auto";
        if (channelMode === "proxy") return true;
        if (channelMode === "transfer") return false;
        // "auto": once a transfer attempt has failed, never attempt again.
        return this.channelTransferSupported === false;
    }

    private postProxyChannel(
        peerAddress: WebRTCPeerAddress,
        record: ConnectionRecord,
        channel: WebRTCDataChannelLike
    ): void {
        record.proxiedChannel = channel;
        this.wireProxyChannel(peerAddress, record, channel);
        this.remote.webRTCBridge
            .proxyChannel(peerAddress, channel.label, channel.readyState)
            .send();
    }

    private wireProxyChannel(
        peerAddress: WebRTCPeerAddress,
        record: ConnectionRecord,
        channel: WebRTCDataChannelLike
    ): void {
        const isCurrentChannel = () =>
            this.connectionsByPeerAddress.get(peerAddress) === record &&
            record.proxiedChannel === channel;

        channel.onmessage = (event: { data: any }) => {
            if (!isCurrentChannel()) return;
            this.remote.webRTCBridge
                .proxyMessage(peerAddress, event.data)
                .send();
        };
        channel.onopen = () => {
            if (!isCurrentChannel()) return;
            this.remote.webRTCBridge
                .proxyState(
                    peerAddress,
                    channel.readyState || "open",
                    "open",
                    undefined
                )
                .send();
        };
        channel.onclose = () => {
            if (!isCurrentChannel()) return;
            delete record.proxiedChannel;
            this.remote.webRTCBridge
                .proxyState(
                    peerAddress,
                    channel.readyState || "closed",
                    "close",
                    undefined
                )
                .send();
        };
        channel.onerror = (error: any) => {
            if (!isCurrentChannel()) return;
            this.remote.webRTCBridge
                .proxyState(
                    peerAddress,
                    channel.readyState || "closed",
                    "error",
                    serializeError(error)
                )
                .send();
        };
    }
}

type BrokerRegistration = {
    broker: Promise<WebRTCMainThreadBridgeRoot>;
    handleCount: number;
};

const brokersByPort = new WeakMap<MessagePort, BrokerRegistration>();

/**
 * Bind a WebRTC main-thread bridge to the `port` surfaced by `p2pSetup` on
 * `P2pInstance.webRTCBridgePort`. Call this on the real main thread (where
 * `RTCPeerConnection` lives) after forwarding the port up through any worker
 * nesting; the broker then drives `RTCPeerConnection` for the worker — however
 * deeply nested — that negotiates WebRTC over the channel.
 */
export function installWebRTCMainThreadBridge(
    port: MessagePort,
    options: WebRTCMainThreadBridgeOptions = {}
): WebRTCMainThreadBridgeHandle {
    // Installing on the same port more than once (nested setups, an effect
    // re-run) shares one broker — a second would clobber its `onmessage`.
    // Ref-count the handles so one handle's dispose (e.g. a stale cleanup)
    // can't close the bridge out from under a still-active owner: only the last
    // outstanding handle tears the broker down.
    const registration = brokersByPort.get(port) ?? {
        broker: createRoot(WebRTCMainThreadBridgeRoot, {
            parentPort: adaptPort(port),
            logger: options.logger,
            args: options
        }),
        handleCount: 0
    };
    if (!brokersByPort.has(port)) {
        void registration.broker.catch((error) =>
            options.logger?.error("WebRTC bridge startup failed", { error })
        );
    }
    registration.handleCount++;
    brokersByPort.set(port, registration);

    let disposed = false;
    return {
        dispose: () => {
            if (disposed) return;
            disposed = true;
            registration.handleCount--;
            if (registration.handleCount > 0) return;
            brokersByPort.delete(port);
            void registration.broker
                .then((root) =>
                    root.dispose().finally(() => root.closeConnections())
                )
                .catch((error) =>
                    options.logger?.error("WebRTC bridge cleanup failed", {
                        error
                    })
                );
        }
    };
}
