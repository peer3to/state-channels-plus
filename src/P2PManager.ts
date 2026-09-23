import type { CustomRpcConstructor } from "./rpc/network/registry";
import RemoteRpcProxy, {
    RemoteRpcProxyType
} from "./rpc/network/RemoteRpcProxy";
import { Address, PeerKey } from "./types/types";
import { runCleanup } from "./utils/runCleanup";
import { DisconnectPolicy, DisconnectTier } from "@/DisconnectPolicy";
import { P2pSigner } from "@/evm";
import Holepunch from "@/Holepunch";
import type PeerProfile from "@/PeerProfile";
import ProfileManager from "@/ProfileManager";
import MainRpcService from "@/rpc/network/MainRpcService";
import { NetworkRpcRouter } from "@/rpc/router/NetworkRpcRouter";
import type StateManager from "@/stateManager";
import type { BlacklistReason } from "@/storage/BlacklistStorage";
import {
    NetworkTransport,
    LoopbackTransport,
    TransportType
} from "@/transport";
import { isNetworkTransport } from "@/transport/NetworkTransport";
import { Status } from "@/types";
import { isEngagedStatus } from "@/types/flags";
import { DebugProxy, getChecksumAddress, LocalDiscoveryServer } from "@/utils";
import type { Logger } from "@/utils";
import { requireBytes32 } from "@/utils/bytes32";
import { config, isNodeRuntime } from "@/utils/config";
import { errorMessage } from "@/utils/errorMessage";
import { LoggerUtils } from "@/utils/LoggerUtils";
import { Buffer } from "buffer";
import { ethers } from "ethers";

// The channel is being given up and every peer is going with it; a verdict,
// suspension or strike recorded now would belong to no channel and, because
// all three outlive the reset, would follow the peer into the next.
const NO_VERDICT_WHILE_RELEASING =
    "Disconnecting peer without a verdict: the channel is being released";

class P2PManager<TCustomRpc extends MainRpcService = MainRpcService> {
    public readonly rpcRouter: NetworkRpcRouter<this>;
    stateManager: StateManager<TCustomRpc>;
    logger: Logger;
    p2pSigner: P2pSigner<TCustomRpc>;
    profileManager: ProfileManager;
    localRpc: TCustomRpc;
    remoteRpc: RemoteRpcProxyType<TCustomRpc>;
    /** In-process transport used for "send to self" (no-target) delivery. */
    loopbackTransport: LoopbackTransport;
    // TODO - route WebRTCSetupService and LocalDiscoveryServer scans through ProfileManager
    openConnections: NetworkTransport[] = [];
    holepunch: Holepunch;
    self = config.DEBUG_P2P_MANAGER ? DebugProxy.createProxy(this) : this;
    preferredTransport: TransportType = TransportType.HOLEPUNCH;

    private disposalPromise?: Promise<void>;
    // The channel topic this runtime joined, left again by the channel reset.
    private channelDiscoveryKey?: string;
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
        this.stateManager = stateManager;
        this.profileManager = new ProfileManager(
            stateManager.storage.blacklist
        );
        this.logger = stateManager.logger.child({ component: "P2PManager" });
        this.rpcRouter = new NetworkRpcRouter(this.self);
        if (config.DEBUG_LOCAL_TRANSPORT) {
            LocalDiscoveryServer.setLogger(this.logger);
        }
        this.p2pSigner = new P2pSigner(
            signer,
            stateManager.signerAddress,
            this.self
        );

        if (customRpc) {
            this.localRpc = new customRpc(
                this.self,
                customRpcOptions
            ) as TCustomRpc;
        } else {
            if (customRpcOptions !== undefined) {
                throw new Error(
                    "customRpcOptions requires customRpc to be configured"
                );
            }
            this.localRpc = new MainRpcService(this.self) as TCustomRpc;
        }
        this.remoteRpc = RemoteRpcProxy.createProxy(
            this.localRpc
        ) as unknown as RemoteRpcProxyType<TCustomRpc>;
        this.loopbackTransport = new LoopbackTransport(this.self.rpcRouter);
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
        return (this.disposalPromise ??= Promise.resolve().then(async () => {
            await runCleanup(
                () => this.unsubscribeHandshakeCompleted(),
                () => this.unsubscribeStatusChanged(),
                () => this.unsubscribeAbort(),
                () => this.settleInitialSync(false),
                () => this.profileManager.dispose(),
                () => {
                    this.openConnections.length = 0;
                },
                () => this.holepunch.dispose()
            );
        }));
    }

    public get isDisposed(): boolean {
        return this.disposalPromise !== undefined;
    }

    /**
     * Channel reset: leave the channel's discovery topic, drop every peer, and
     * forget every profile except blacklisted ones. The swarm and the custom
     * RPC root survive. The initial-sync latch is re-armed separately, once
     * the reset's status change is done.
     */
    public async resetChannel(): Promise<void> {
        await runCleanup(
            () => this.leaveChannelDiscovery(),
            () => this.localRpc.resetChannel(),
            // disconnectAll rejects each transport's pending RPCs; the profile
            // release then reaches transports registered but never opened
            // (lobby, handoff).
            () => this.disconnectAll(),
            () => this.profileManager.releaseChannelPeers()
        );
    }

    /** Join the selected channel's topic and remember it for the reset. */
    public async joinChannelDiscovery(discoveryKey: string): Promise<void> {
        this.channelDiscoveryKey = ethers.hexlify(discoveryKey);
        await this.joinDiscoveryKey(discoveryKey);
    }

    public async leaveChannelDiscovery(): Promise<void> {
        const discoveryKey = this.channelDiscoveryKey;
        if (!discoveryKey) return;
        this.channelDiscoveryKey = undefined;
        await this.leaveDiscoveryKey(discoveryKey);
    }

    /**
     * Re-arm the initial-sync latch so the next channel waits for its own
     * first sync. The latch settles on any status change out of OPENED, so
     * this must run after the reset has set its own status.
     */
    public rearmInitialSync(): void {
        // A wait created for the old channel must not hang: settle it as failed
        // before the latch is re-armed for the next one.
        this.settleInitialSync(false);
        this.initialSyncStarted = false;
        this.initialSyncSettled = false;
        this.initialSyncOutcome = false;
        this.initialSyncPromise = undefined;
        this.resolveInitialSync = undefined;
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
        const generation = stateManager.channelGeneration;
        const success = await this.localRpc.spectateService.sync(
            peerAddress,
            stateManager.channelId,
            undefined,
            undefined,
            stateManager.timeConfig.agreementTime * 2 * 1000
        );
        // The runtime left that channel while the sync ran. Its result belongs
        // to no current wait, and settling now would mark the next channel's
        // re-armed initial sync as already done.
        if (stateManager.isStaleChannelWork(generation)) return;
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
        transports: Iterable<NetworkTransport>,
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
        const join = (async () => {
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
        })();

        if (!initialSync) {
            await join;
            return;
        }
        // An abort during the join answers the pending connect now rather
        // than when the join returns: the disposal the abort starts closes
        // the port, and a reply that only leaves after that never arrives.
        // The wait settles on abort and on disposal, so racing it is enough;
        // the join finishes in the background under that disposal. Any other
        // settlement keeps waiting for the join as before.
        await Promise.race([join, initialSync]);
        if (this.stateManager.isDisposed) {
            this.settleInitialSync(false);
            return;
        }
        await join;
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
    public addConnection(transport: NetworkTransport) {
        // Do not revive a transport that closed while handshake work was pending.
        if (transport.isClosed) return;
        if (!this.openConnections.includes(transport)) {
            this.openConnections.push(transport);
        }
    }

    /**
     * The single owner of every disconnect. The policy is a required argument
     * so no close inherits another caller's decision: `ALLOW` closes only,
     * `allowRetry(n)` closes until the peer's session bound is reached,
     * `SUSPEND` bars the peer for this session, and `BLACKLIST` also records
     * the verdict. A transport closes that one pipe; an address closes every
     * live transport of that identity and still records a strike or a verdict
     * when none is live. `verifiedPeerAddress` is the EVM identity a transport
     * already proved but has not registered yet (the handshake acknowledgement
     * is still outstanding); a suspension that lands on such a transport bars
     * that identity together with the transport's own key.
     */
    public disconnectConnection(
        peer: NetworkTransport | Address,
        policy: DisconnectPolicy,
        reason?: BlacklistReason,
        verifiedPeerAddress?: Address
    ) {
        // Transports may come from another module graph, so the structural
        // check decides, not `instanceof`.
        const isTransport = isNetworkTransport(peer);
        if (
            policy.tier !== DisconnectTier.ALLOW &&
            this.stateManager.isResettingChannel
        ) {
            this.logger.warn(
                NO_VERDICT_WHILE_RELEASING,
                isTransport
                    ? LoggerUtils.getTransportMetadata(peer)
                    : { peerAddress: peer, reason }
            );
            policy = DisconnectPolicy.ALLOW;
        }
        const profile = isTransport
            ? this.profileManager.getProfileForFault(peer)
            : this.profileManager.getProfileByEvmAddress(peer);
        const appliedTier = this.resolveDisconnectTier(peer, profile, policy);
        const isPunitive =
            appliedTier === DisconnectTier.BLACKLIST ||
            appliedTier === DisconnectTier.SUSPEND;
        // A plain close takes only the pipe it was asked about.
        if (isTransport && !isPunitive) {
            this.closeConnection(peer);
            return;
        }
        if (isPunitive) {
            const isBlacklist = appliedTier === DisconnectTier.BLACKLIST;
            this.logger.warn(
                isBlacklist
                    ? "Disconnecting and blacklisting peer"
                    : "Disconnecting and suspending peer",
                isTransport
                    ? LoggerUtils.getTransportMetadata(peer)
                    : { peerAddress: peer, reason }
            );
            // A proven peer is excluded by identity; an unproven transport by
            // its own handle.
            const target = isTransport ? peer.peerAddress || peer : peer;
            if (isBlacklist) this.profileManager.blacklistPeer(target, reason);
            else this.profileManager.suspendPeer(target);
            if (!isBlacklist && verifiedPeerAddress) {
                this.profileManager.suspendPeer(verifiedPeerAddress);
            }
        }
        // A punitive close, or a close by address, takes every live transport
        // of the identity with it.
        const transports = new Set<NetworkTransport>(
            profile?.getLiveTransports() ?? []
        );
        if (isTransport) transports.add(peer);
        for (const transport of transports) this.closeConnection(transport);
    }

    /**
     * Collapses the bounded tier onto a constant one. Each `ALLOW_RETRY` close
     * counts against the peer's single session counter, keyed by its EVM
     * address once proven and by its Hyperswarm key before; the close that
     * reaches the bound is applied as `SUSPEND`, every earlier one as
     * `ALLOW`. A transport with no key at all stays `ALLOW`, and so does a
     * transport this node already closed: that close stated its own policy,
     * and the request it rejected on the way out is not a second event.
     */
    private resolveDisconnectTier(
        peer: NetworkTransport | Address,
        profile: PeerProfile | undefined,
        policy: DisconnectPolicy
    ): DisconnectTier {
        if (policy.tier !== DisconnectTier.ALLOW_RETRY) return policy.tier;
        if (isNetworkTransport(peer) && peer.isClosed) {
            return DisconnectTier.ALLOW;
        }
        const key = profile
            ? this.profileManager.profileKey(profile)
            : isNetworkTransport(peer)
              ? undefined
              : peer;
        if (!key) return DisconnectTier.ALLOW;
        const boundReached = this.profileManager.countRetryDisconnect(
            key,
            policy.maxRetries
        );
        return boundReached ? DisconnectTier.SUSPEND : DisconnectTier.ALLOW;
    }

    public disconnectAndBlacklistPeerByEvmAddress(
        evmAddress: Address,
        reason?: BlacklistReason
    ) {
        this.disconnectConnection(
            evmAddress,
            DisconnectPolicy.BLACKLIST,
            reason
        );
    }

    public disconnectAndBlacklistPeers(
        peers: Iterable<Address>,
        reason?: BlacklistReason
    ) {
        for (const peer of peers) {
            this.disconnectAndBlacklistPeerByEvmAddress(peer, reason);
        }
    }

    /** The close itself, shared by every policy. Never punitive. */
    private closeConnection(transport: NetworkTransport) {
        const profile = this.profileManager.getProfileByTransport(transport);

        this.rpcRouter.rejectPendingRpcRequestsForTransport(
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

    public isBlacklisted(evmAddress: Address): boolean {
        return this.profileManager.isBlacklisted(evmAddress);
    }

    public isSuspended(key: PeerKey): boolean {
        return this.profileManager.isSuspended(key);
    }

    public disconnectAll() {
        for (const transport of this.openConnections) {
            this.disconnectConnection(transport, DisconnectPolicy.ALLOW);
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
