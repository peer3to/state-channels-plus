import type { CustomRpcConstructor } from "./rpc/registry";
import { Address } from "./types/types";
import { P2pSigner } from "@/evm";
import Holepunch from "@/Holepunch";
import IOnMessage from "@/IOnMessage";
import ProfileManager from "@/ProfileManager";
import MainRpcService from "@/rpc/MainRpcService";
import type { RemoteRpcServices } from "@/rpc/RemoteRpcProxy";
import Rpc from "@/rpc/Rpc";
import { RpcRouter } from "@/rpc/RpcRouter";
import type StateManager from "@/stateManager";
import { ATransport, LoopbackTransport, TransportType } from "@/transport";
import { Status } from "@/types";
import { isEngagedStatus } from "@/types/flags";
import type { Logger } from "@/utils";
import { DebugProxy, getChecksumAddress, LocalDiscoveryServer } from "@/utils";
import { requireBytes32 } from "@/utils/bytes32";
import { config, isNodeRuntime } from "@/utils/config";
import { errorMessage } from "@/utils/errorMessage";
import { LoggerUtils } from "@/utils/LoggerUtils";
import { Buffer } from "buffer";
import { ethers } from "ethers";

/** the peers' router: one for the realm, one transport per connected peer */
class P2PManager<TCustomRpc extends MainRpcService = MainRpcService>
    extends RpcRouter<TCustomRpc, TCustomRpc>
    implements IOnMessage
{
    stateManager: StateManager<TCustomRpc>;
    /** the peer services as this node calls them. the base cannot resolve
     *  `RemoteRpcServices<TCustomRpc>` while TCustomRpc is a type parameter, so
     *  the main services are named beside it -> a custom-rpc manager is still a
     *  P2PManager. */
    declare remoteRpc: RemoteRpcServices<MainRpcService> &
        RemoteRpcServices<TCustomRpc>;
    p2pSigner: P2pSigner<TCustomRpc>;
    profileManager = new ProfileManager();
    /** In-process transport used for "send to self" (no-target) delivery. */
    loopbackTransport: LoopbackTransport;
    // TODO - route WebRTCSetupService and LocalDiscoveryServer scans through ProfileManager
    openConnections: ATransport[] = [];
    holepunch: Holepunch;
    self = config.DEBUG_P2P_MANAGER ? DebugProxy.createProxy(this) : this;
    preferredTransport: TransportType = TransportType.HOLEPUNCH;
    private disposalPromise?: Promise<void>;
    private readonly unsubscribeHandshakeCompleted: () => void;
    // Settle the initial-sync wait when the runtime leaves OPENED for any
    // reason other than the sync request itself: chain genesis moves the
    // status, and an abort keeps OPENED but announces itself through its hook.
    private readonly unsubscribeStatusChanged: () => void;
    private readonly unsubscribeAbort: () => void;
    private initialSyncStarted = false;
    private initialSyncSettled = false;
    // Remembered so a wait created after settlement (abort before the
    // discovery join) resolves at once instead of never.
    private initialSyncOutcome = false;
    private initialSyncPromise?: Promise<boolean>;
    private resolveInitialSync?: (success: boolean) => void;
    // Bounds the wait for the first cooperating participant handshake. An
    // observer that never reaches a sync request must not wait forever.
    private initialSyncDeadline?: ReturnType<typeof setTimeout>;

    constructor(
        stateManager: StateManager<TCustomRpc>,
        signer: ethers.Signer,
        customRpc?: CustomRpcConstructor<TCustomRpc, any>,
        customRpcOptions?: any
    ) {
        // `agreementTime` is in seconds; the RPC timeout is in milliseconds.
        super(
            undefined,
            stateManager.logger.child({ component: "P2PManager" }),
            {
                timer: stateManager.timeoutManager,
                defaultTimeoutMs: stateManager.timeConfig.agreementTime * 1000
            }
        );
        this.stateManager = stateManager;
        // ----- peer policy: what the shared router core leaves to its owner -----
        this.resolveTransport = (address) =>
            this.profileManager.getTransportByEvmAddress(address) ?? undefined;
        // Only the peer we sent the request to may settle it. Compare by peer
        // identity (not transport object) so a transport upgrade for the same
        // peer (e.g. HOLEPUNCH -> WEBRTC) still settles the pending request.
        this.isSameSender = ATransport.isSamePeer;
        // a frame the router refused is a protocol violation: the peer is
        // dropped and banned, as it was before the router. one of our own
        // handlers failing is not the peer's doing, so that only drops the line.
        this.onBadFrame = (transport, _error, kind) => {
            if (kind === "handler") {
                this.disconnectConnection(transport);
                return;
            }
            this.disconnectAndBlacklistPeer(transport);
        };
        this.onFrameDispatched = (rpc, transport) => {
            this.logger.verbose("onRpc", {
                rpc: LoggerUtils.getRpcLogMetadata(rpc),
                transportType: TransportType[transport.transportType],
                peerAddress: transport.peerAddress
            });
        };
        if (config.DEBUG_LOCAL_TRANSPORT) {
            LocalDiscoveryServer.setLogger(this.logger);
        }
        this.p2pSigner = new P2pSigner(
            signer,
            stateManager.signerAddress,
            this.self
        );

        if (customRpc) {
            this.attachRoot(
                new customRpc(this.self, customRpcOptions) as TCustomRpc
            );
        } else {
            if (customRpcOptions !== undefined) {
                throw new Error(
                    "customRpcOptions requires customRpc to be configured"
                );
            }
            this.attachRoot(new MainRpcService(this.self) as TCustomRpc);
        }
        this.loopbackTransport = new LoopbackTransport(this.self);
        this.holepunch = new Holepunch(this.self);

        this.unsubscribeStatusChanged = this.stateManager.events.on(
            "p2pEventHooks",
            "onStatusChanged",
            (oldStatus, newStatus) => {
                if (
                    oldStatus !== Status.OPENED ||
                    newStatus === Status.OPENED
                ) {
                    return;
                }
                this.settleInitialSync(isEngagedStatus(newStatus));
            }
        );
        this.unsubscribeAbort = this.stateManager.events.on(
            "p2pEventHooks",
            "onAbort",
            () => this.settleInitialSync(false)
        );
        this.unsubscribeHandshakeCompleted = this.stateManager.events.on(
            "p2pEventHooks",
            "handshakeCompleted",
            (peerAddress) => {
                void this.onHandshakeCompleted(peerAddress);
            }
        );
        return this.self;
    }
    //Mark resources for garbage collection
    public dispose(): Promise<void> {
        if (this.disposalPromise) {
            return this.disposalPromise;
        }

        this.unsubscribeHandshakeCompleted();
        this.unsubscribeStatusChanged();
        this.unsubscribeAbort();
        this.settleInitialSync(false);
        this.disconnectAll();
        this.disposalPromise = this.holepunch.dispose();
        return this.disposalPromise;
    }

    public get isDisposed(): boolean {
        return this.disposalPromise !== undefined;
    }

    private async onHandshakeCompleted(peerAddress: Address): Promise<void> {
        const stateManager = this.stateManager;
        if (stateManager.isDisposed) return;

        const transport =
            this.profileManager.getTransportByEvmAddress(peerAddress);
        if (!transport || transport.isClosed) return;

        const status = stateManager.status;
        const isChannelOpened = status === Status.OPENED;
        if (this.localRpc.lobbyMatchingService.rendezvousTopic) {
            // Lobby transports stay outside the ordinary connection set until
            // matching commits one peer. The lobby service owns their complete
            // lifecycle and promotes only the selected profile.
            const profile =
                this.profileManager.getProfileByEvmAddress(peerAddress);
            for (const lobbyTransport of profile?.getLiveTransports() ?? [
                transport
            ]) {
                if (
                    this.localRpc.lobbyMatchingService.isHandedOffTransport(
                        lobbyTransport
                    )
                ) {
                    continue;
                }
                this.localRpc.lobbyMatchingService.onAuthenticatedTransport(
                    lobbyTransport
                );
            }
            return;
        }

        this.addConnection(transport);

        if (isChannelOpened) {
            try {
                const isPeerParticipant =
                    await stateManager.diamondStateMachine.localDiamondContract.canParticipateInDisputes(
                        stateManager.channelId,
                        peerAddress
                    );
                if (stateManager.isDisposed || transport.isClosed) return;
                if (isPeerParticipant) {
                    await this.syncConnectedParticipant(peerAddress);
                } else {
                    this.logger.debug(
                        `Skipping sync after handshake with peer ${peerAddress} - not a participant`
                    );
                }
            } catch (error) {
                if (stateManager.isDisposed || transport.isClosed) return;
                this.logger.debug(
                    "Skipping sync after handshake because the participant read failed",
                    {
                        peerAddress,
                        error: errorMessage(error)
                    }
                );
            }
        }

        stateManager.p2pEventHooks.onConnection?.(peerAddress, isChannelOpened);
    }

    private async syncConnectedParticipant(
        peerAddress: Address
    ): Promise<void> {
        if (this.initialSyncStarted) return;
        this.initialSyncStarted = true;
        this.cancelInitialSyncDeadline();
        const stateManager = this.stateManager;
        const success = await this.localRpc.spectateService.sync(
            peerAddress,
            stateManager.channelId,
            undefined,
            undefined,
            stateManager.timeConfig.agreementTime * 2 * 1000
        );
        // A result that lands after the chain already supplied the state is
        // stale: the wait settled through the status hook and a late false
        // must not abort an already synced runtime.
        if (this.initialSyncSettled || stateManager.status !== Status.OPENED) {
            this.settleInitialSync(success);
            return;
        }
        if (!success && !stateManager.isDisposed) {
            stateManager.abort();
        }
        this.settleInitialSync(success);
    }

    private settleInitialSync(success: boolean): void {
        this.cancelInitialSyncDeadline();
        if (this.initialSyncSettled) return;
        this.initialSyncSettled = true;
        this.initialSyncOutcome = success;
        this.resolveInitialSync?.(success);
    }

    /** Promotes the committed lobby profile into the normal connection set. */
    public promoteLobbyConnections(
        transports: Iterable<ATransport>,
        peerAddress: Address
    ): void {
        let promoted = false;
        for (const transport of transports) {
            if (transport.isClosed) continue;
            this.addConnection(transport);
            promoted = true;
        }
        if (promoted) {
            this.stateManager.p2pEventHooks.onConnection?.(peerAddress, false);
        }
    }
    /** peers are broadcast to over the curated connection set, not over every
     *  transport this router holds: a lobby or unauthenticated line is not one
     *  of them yet */
    public broadcastRpc(rpc: Rpc) {
        const debugConnections = this.openConnections.map((transport) => {
            return {
                transportType: transport.transportType,
                peerAddress: transport.peerAddress
            };
        });
        this.logger.debug("broadcastRpc", {
            rpc: LoggerUtils.getRpcLogMetadata(rpc),
            debugConnections
        });
        for (const transport of this.openConnections) {
            transport.send(rpc);
        }
    }

    /** every peer transport gets its profile as it is built */
    public onTransportCreated(transport: ATransport): void {
        super.onTransportCreated(transport);
        this.profileManager.registerTransport(transport);
    }

    public onTransportClosed(transport: ATransport, isExpected: boolean): void {
        if (!isExpected) {
            this.stateManager.p2pEventHooks?.onDisconnection?.(
                transport.peerAddress as Address
            );
        }
        // rejects what this line still owed with the peer-facing cause, so the
        // base is left with nothing to reject
        this.disconnectConnection(transport);
        super.onTransportClosed(transport, isExpected);
    }

    public async joinDiscoveryKey(discoveryKey: string): Promise<void> {
        requireBytes32(discoveryKey, "Discovery key must be exactly 32 bytes");
        const normalizedKey = ethers.hexlify(discoveryKey);
        const waitForInitialSync = this.stateManager.status === Status.OPENED;
        const initialSync = waitForInitialSync
            ? this.getInitialSyncPromise()
            : undefined;
        // TODO: Give Holepunch and LocalDiscoveryServer the same lifecycle API
        // and inject the selected backend so P2PManager does not know which
        // discovery implementation it is using.
        if (config.DEBUG_LOCAL_TRANSPORT) {
            if (isNodeRuntime() || config.LOCAL_DISCOVERY_REGISTRY_URL) {
                await LocalDiscoveryServer.tryStart();
                await LocalDiscoveryServer.connectToPeers(
                    this.self,
                    normalizedKey,
                    this.stateManager.signerAddress.toString()
                );
            }
        } else {
            const topic = Buffer.from(normalizedKey.slice(2), "hex");
            await this.holepunch.join(topic);
        }

        if (!initialSync) return;
        // The status may have left OPENED during the discovery join (chain
        // genesis, abort). Nothing later would settle the wait, so settle now.
        if (this.stateManager.isDisposed) {
            this.settleInitialSync(false);
            return;
        }
        if (this.stateManager.status !== Status.OPENED) {
            this.settleInitialSync(isEngagedStatus(this.stateManager.status));
            return;
        }
        for (const transport of [...this.openConnections]) {
            if (transport.peerAddress && !transport.isClosed) {
                void this.onHandshakeCompleted(transport.peerAddress);
            }
        }
        this.armInitialSyncDeadline();
        await initialSync;
    }

    /**
     * The initial sync request carries its own two-window timeout. This bound
     * covers the phase before that request exists: if no participant completes
     * a handshake within the same two windows, the observer stops waiting and
     * aborts, exactly as a timed-out sync request would.
     */
    private armInitialSyncDeadline(): void {
        this.cancelInitialSyncDeadline();
        if (this.initialSyncStarted) return;
        const stateManager = this.stateManager;
        this.initialSyncDeadline = stateManager.timeoutManager.scheduleTask(
            () => {
                this.initialSyncDeadline = undefined;
                if (this.initialSyncStarted || stateManager.isDisposed) return;
                if (stateManager.status !== Status.OPENED) {
                    this.settleInitialSync(
                        isEngagedStatus(this.stateManager.status)
                    );
                    return;
                }
                this.logger.warn(
                    "No participant completed a handshake within the initial sync window; aborting"
                );
                stateManager.abort();
                this.settleInitialSync(false);
            },
            stateManager.timeConfig.agreementTime * 2 * 1000,
            "P2PManager - initial sync participant deadline"
        );
    }

    private cancelInitialSyncDeadline(): void {
        if (!this.initialSyncDeadline) return;
        this.stateManager.timeoutManager.cancelTask(this.initialSyncDeadline);
        this.initialSyncDeadline = undefined;
    }

    private getInitialSyncPromise(): Promise<boolean> {
        if (this.initialSyncSettled) {
            return Promise.resolve(this.initialSyncOutcome);
        }
        if (!this.initialSyncPromise) {
            this.initialSyncPromise = new Promise<boolean>((resolve) => {
                this.resolveInitialSync = resolve;
            });
        }
        return this.initialSyncPromise;
    }

    public async leaveDiscoveryKey(discoveryKey: string): Promise<void> {
        requireBytes32(discoveryKey, "Discovery key must be exactly 32 bytes");
        const normalizedKey = ethers.hexlify(discoveryKey);
        if (config.DEBUG_LOCAL_TRANSPORT) {
            await LocalDiscoveryServer.leave(normalizedKey, this.self);
            return;
        }
        const topic = Buffer.from(normalizedKey.slice(2), "hex");
        await this.holepunch.leave(topic);
    }
    public addConnection(transport: ATransport) {
        // Do not revive a transport that closed while handshake work was pending.
        if (transport.isClosed) return;
        if (!this.openConnections.includes(transport)) {
            this.openConnections.push(transport);
        }
    }

    public disconnectConnection(transport: ATransport) {
        const profile = this.profileManager.getProfileByTransport(transport);

        this.rejectPending(
            transport,
            new Error("Peer disconnected before RPC response arrived")
        );

        this.openConnections = this.openConnections.filter(
            (t) => t !== transport
        );
        this.profileManager.releaseHolepunchBanOnWebRtcClose(transport);

        try {
            if (profile) {
                this.profileManager.removeTransport(transport);
            } else {
                transport.close();
            }
        } catch {
            // ignore
        }
    }

    public disconnectAndBlacklistPeer(transport: ATransport) {
        this.logger.warn(
            "Disconnecting and blacklisting peer transport",
            LoggerUtils.getTransportMetadata(transport)
        );
        const transportToDisconnect = transport.peerAddress
            ? this.profileManager.blacklistPeer(transport.peerAddress)
            : this.profileManager.blacklistPeer(transport);
        if (transportToDisconnect && transportToDisconnect !== transport) {
            this.disconnectConnection(transportToDisconnect);
        }
        this.disconnectConnection(transport);
    }

    public disconnectAndBlacklistPeerByEvmAddress(evmAddress: Address) {
        this.logger.warn("Disconnecting and blacklisting peer address", {
            peerAddress: evmAddress
        });
        const transport = this.profileManager.blacklistPeer(evmAddress);
        if (transport) this.disconnectConnection(transport);
    }

    public disconnectAndBlacklistPeers(peers: Iterable<Address>) {
        for (const peer of peers) {
            this.disconnectAndBlacklistPeerByEvmAddress(peer);
        }
    }

    public isBlacklisted(evmAddress: Address): boolean {
        return (
            this.profileManager.getProfileByEvmAddress(evmAddress)
                ?.isBlackListed || false
        );
    }

    public disconnectAll() {
        for (const transport of this.openConnections) {
            this.disconnectConnection(transport);
        }
    }

    /**
     * Returns a snapshot of currently connected peer identities (EVM addresses).
     * Resolve transport addresses first, falling back to their registered profiles.
     */
    public getConnectedPeers(): Set<Address> {
        const addresses = new Set<Address>();
        for (const transport of this.openConnections) {
            const fromTransport = transport.peerAddress;
            if (fromTransport) {
                // Boundary: transport.peerAddress can originate outside ethers.
                addresses.add(getChecksumAddress(fromTransport));
                continue;
            }

            const profile =
                this.profileManager.getProfileByTransport(transport);
            const fromProfile = profile?.getEvmAddress();
            if (fromProfile) {
                addresses.add(fromProfile.toString());
            }
        }
        return addresses;
    }
}

export default P2PManager;
