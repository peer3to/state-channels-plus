import type {
    CustomRpcConstructor,
    CustomRpcContext
} from "./rpc/network/registry";
import RemoteRpcProxy, {
    RemoteRpcProxyType
} from "./rpc/network/RemoteRpcProxy";
import { Address, ChecksumAddress, PeerKey } from "./types/types";
import { runCleanup, runCleanupSync } from "./utils/runCleanup";
import { DoubleSignatureReport, onDoubleSignature } from "@/cache";
import { DisconnectPolicy, DisconnectTier } from "@/DisconnectPolicy";
import P2pSigner from "@/evm/signer/LocalP2pSigner";
import Holepunch from "@/Holepunch";
import type PeerProfile from "@/PeerProfile";
import ProfileManager from "@/ProfileManager";
import MainRpcService from "@/rpc/network/MainRpcService";
import { SyncResult } from "@/rpc/network/services/spectate/SpectateService";
import { NetworkRpcRouter } from "@/rpc/router/NetworkRpcRouter";
import type StateManager from "@/stateManager";
import { SourceEligibility } from "@/stateManager/membership/MembershipService";
import type { BlacklistReason } from "@/storage/BlacklistStorage";
import {
    NetworkTransport,
    LoopbackTransport,
    TransportType,
    type OpenConnection
} from "@/transport";
import { isNetworkTransport } from "@/transport/NetworkTransport";
import { Status } from "@/types";
import { isEngagedStatus } from "@/types/flags";
import {
    DebugProxy,
    DetachedPromises,
    getChecksumAddress,
    LocalDiscoveryServer
} from "@/utils";
import type { Logger } from "@/utils";
import { addressesEqual } from "@/utils/address";
import { requireBytes32 } from "@/utils/bytes32";
import { config, isNodeRuntime } from "@/utils/config";
import { errorMessage } from "@/utils/errorMessage";
import { LoggerUtils } from "@/utils/LoggerUtils";
import { Buffer } from "buffer";
import { ethers } from "ethers";

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

    /** Set first by `dispose`: the network is cut, wire sends and frames drop. */
    private isCut = false;
    private markNetworkCut!: () => void;
    /** Resolves when `dispose` cuts the network. */
    public readonly networkCut = new Promise<void>((resolve) => {
        this.markNetworkCut = resolve;
    });
    private disposalPromise?: Promise<void>;
    private readonly unsubscribeHandshakeCompleted: () => void;
    // Settle the initial-sync wait when the runtime leaves OPENED for any
    // reason other than the sync request itself: chain genesis moves the
    // status, and an abort keeps OPENED but announces itself through its hook.
    private readonly unsubscribeStatusChanged: () => void;
    private readonly unsubscribeAbort: () => void;
    // Removes this manager's double-signature handler from the thread-wide
    // signer recovery cache on dispose.
    private readonly unsubscribeDoubleSignature: () => void;
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
    // Completed handshakes still in their participant check or the sync it
    // starts. One running holds an elapsed initial-sync deadline.
    private participantChecksInFlight = 0;
    private isInitialSyncDeadlineHeld = false;
    // Participants that answered they are still in their own initial sync,
    // each with its pending re-ask (undefined once it fired).
    private readonly syncingPeerRetries = new Map<
        ChecksumAddress,
        ReturnType<typeof setTimeout> | undefined
    >();
    // Participants checked while another initial sync request ran: the ones
    // to sync from when that request's peer answers it is still syncing.
    private readonly waitingParticipants = new Set<ChecksumAddress>();

    /**
     * `signer` must be deterministic (RFC 6979, as ethers wallets are): one
     * message always yields one signature. A signer that picks a random
     * nonce (for example a KMS signer) produces a second, different signature
     * when it re-signs, and peers blacklist it as a double signer.
     */
    constructor(
        stateManager: StateManager<TCustomRpc>,
        signer: ethers.Signer,
        localContext: CustomRpcContext,
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
                customRpcOptions,
                localContext
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
            (peerAddress) =>
                DetachedPromises.collect(this.onHandshakeCompleted(peerAddress))
        );
        this.unsubscribeDoubleSignature = onDoubleSignature((report) =>
            this.onDoubleSignature(report)
        );
        return this.self;
    }
    // Cuts the network: every transport closes in this call, and only the
    // discovery teardown runs after it.
    public dispose(): Promise<void> {
        if (this.disposalPromise) return this.disposalPromise;
        this.isCut = true;
        this.markNetworkCut();
        return (this.disposalPromise = runCleanup(
            () =>
                runCleanupSync(
                    () => this.unsubscribeHandshakeCompleted(),
                    () => this.unsubscribeStatusChanged(),
                    () => this.unsubscribeAbort(),
                    () => this.unsubscribeDoubleSignature(),
                    () => this.settleInitialSync(false),
                    () => this.profileManager.dispose(),
                    () => {
                        this.openConnections.length = 0;
                    }
                ),
            () => this.holepunch.dispose()
        ));
    }

    public get isDisposed(): boolean {
        return this.isCut;
    }

    /**
     * Blacklists the signer of a detected double signature. The signer is the
     * offender, never the peer that relayed it; this node never blacklists
     * itself. Only signers the membership cache currently knows as eligible
     * are blacklisted, so throwaway keys cannot grow the blacklist. Runs
     * inside signer recovery, so it never throws.
     */
    private onDoubleSignature(report: DoubleSignatureReport): void {
        try {
            if (
                addressesEqual(report.signer, this.stateManager.signerAddress)
            ) {
                this.logger.error(
                    "Double signature under this node's own key; the signer is non-deterministic or the key is used elsewhere",
                    LoggerUtils.getDoubleSignatureMetadata(report, true)
                );
                return;
            }
            const eligibility =
                this.stateManager.membershipService.getCachedSourceEligibility(
                    report.signer
                );
            if (eligibility !== SourceEligibility.ELIGIBLE) {
                this.logger.debug(
                    "Double signature by a non-eligible signer; ignoring",
                    {
                        ...LoggerUtils.getDoubleSignatureMetadata(report),
                        eligibility: SourceEligibility[eligibility]
                    }
                );
                return;
            }
            this.logger.warn(
                "Double signature detected; blacklisting the signer",
                LoggerUtils.getDoubleSignatureMetadata(report, true)
            );
            this.disconnectAndBlacklistPeerByEvmAddress(
                report.signer,
                "double signature"
            );
        } catch (error) {
            this.logger.error("Failed to handle a double signature", {
                ...LoggerUtils.getDoubleSignatureMetadata(report),
                error: errorMessage(error)
            });
        }
    }

    private async onHandshakeCompleted(peerAddress: Address): Promise<void> {
        const stateManager = this.stateManager;
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
            await this.syncIfParticipant(peerAddress, transport);
            // a check cut by teardown reports no connection
            if (transport.isClosed) return;
        }

        stateManager.p2pEventHooks.onConnection?.(peerAddress, isChannelOpened);
    }

    private async syncIfParticipant(
        peerAddress: Address,
        transport: NetworkTransport
    ): Promise<void> {
        const stateManager = this.stateManager;
        this.participantChecksInFlight += 1;
        try {
            // the chain, not the local mirror: a fresh peer's mirror can
            // miss a slash (the chain's set excludes slashed peers), and
            // its own slash recovery would then cut the initial sync it
            // depends on
            const isPeerParticipant =
                await stateManager.stateChannelManagerContract.canParticipateInDisputes(
                    stateManager.channelId,
                    peerAddress
                );
            if (transport.isClosed) return;
            if (isPeerParticipant) {
                await this.syncConnectedParticipant(peerAddress);
            } else {
                this.logger.debug(
                    `Skipping sync after handshake with peer ${peerAddress} - not a participant`
                );
            }
        } catch (error) {
            // a read or sync cut by teardown is no failure; any other is
            // fatal: the protocol assumes a working RPC connection
            if (transport.isClosed) return;
            this.logger.error(
                "Participant read or sync after handshake failed",
                {
                    peerAddress,
                    error: errorMessage(error)
                }
            );
            throw error;
        } finally {
            this.participantChecksInFlight -= 1;
            // An elapsed deadline this check held fires once no check or sync runs.
            if (this.isInitialSyncDeadlineHeld)
                this.expireInitialSyncDeadline();
        }
    }

    private async syncConnectedParticipant(
        peerAddress: Address
    ): Promise<void> {
        if (this.initialSyncStarted) {
            this.waitingParticipants.add(getChecksumAddress(peerAddress));
            return;
        }
        this.initialSyncStarted = true;
        const stateManager = this.stateManager;
        const result = await this.localRpc.spectateService.requestSync(
            peerAddress,
            stateManager.channelId
        );
        if (result === SyncResult.ResponderSyncing) {
            this.onResponderSyncing(peerAddress);
            return;
        }
        const success = result === SyncResult.Synced;
        // A result that lands after the chain already supplied the state is
        // stale: the wait settled through the status hook and a late false
        // must not abort an already synced runtime.
        if (this.initialSyncSettled || stateManager.status !== Status.OPENED) {
            this.settleInitialSync(success);
            return;
        }
        if (!success) stateManager.abort();
        this.settleInitialSync(success);
    }

    /**
     * The participant has no state to prove yet: no failure. Sync from a
     * participant checked meanwhile now, and ask this one again after half a
     * window (twice within the deadline). A participant answering this for the
     * first time re-arms the deadline, so the wait stays bounded and a table
     * with no usable participant aborts.
     */
    private onResponderSyncing(peerAddress: Address): void {
        this.initialSyncStarted = false;
        const stateManager = this.stateManager;
        if (this.initialSyncSettled || stateManager.status !== Status.OPENED)
            return;
        const syncingPeer = getChecksumAddress(peerAddress);
        if (!this.syncingPeerRetries.has(syncingPeer)) {
            this.armInitialSyncDeadline();
        }
        const pendingRetry = this.syncingPeerRetries.get(syncingPeer);
        if (pendingRetry) stateManager.timeoutManager.cancelTask(pendingRetry);
        this.syncingPeerRetries.set(
            syncingPeer,
            stateManager.timeoutManager.scheduleTask(
                () => this.askSyncingPeerAgain(syncingPeer),
                (stateManager.timeConfig.agreementTime * 1000) / 2,
                "P2PManager - ask a syncing participant again"
            )
        );
        const waiting = [...this.waitingParticipants];
        this.waitingParticipants.clear();
        for (const participant of waiting) {
            if (participant === syncingPeer) continue;
            const transport =
                this.profileManager.getTransportByEvmAddress(participant);
            if (transport)
                DetachedPromises.collect(
                    this.syncIfParticipant(participant, transport)
                );
        }
    }

    private askSyncingPeerAgain(syncingPeer: ChecksumAddress): void {
        if (this.initialSyncSettled) return;
        this.syncingPeerRetries.set(syncingPeer, undefined);
        const transport =
            this.profileManager.getTransportByEvmAddress(syncingPeer);
        if (!transport || transport.isClosed) return;
        DetachedPromises.collect(
            this.syncIfParticipant(syncingPeer, transport)
        );
    }

    private settleInitialSync(success: boolean): void {
        this.cancelInitialSyncDeadline();
        for (const retry of this.syncingPeerRetries.values()) {
            if (retry) this.stateManager.timeoutManager.cancelTask(retry);
        }
        this.syncingPeerRetries.clear();
        this.waitingParticipants.clear();
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
            ? this.isInitialSyncSuccessfulWait()
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
                DetachedPromises.collect(
                    this.onHandshakeCompleted(transport.peerAddress)
                );
            }
        }
        this.armInitialSyncDeadline();
        await initialSync;
    }

    /**
     * The outcome of this runtime's initial sync: resolves once it settles
     * (success, abort, disposal, or the status leaving OPENED).
     */
    public isInitialSyncSuccessfulWait(): Promise<boolean> {
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

    /**
     * The initial sync request uses the sync service's two-window default
     * timeout. This bound covers the time without a usable participant: if
     * none completes a handshake, or every one asked is still syncing, within
     * two windows, the observer stops waiting and aborts, exactly as a
     * timed-out sync request would. A participant check or sync still running
     * holds the deadline until it answers; a running sync keeps the deadline
     * it has.
     */
    private armInitialSyncDeadline(): void {
        if (this.initialSyncStarted) return;
        this.cancelInitialSyncDeadline();
        const stateManager = this.stateManager;
        this.initialSyncDeadline = stateManager.timeoutManager.scheduleTask(
            () => {
                this.initialSyncDeadline = undefined;
                this.expireInitialSyncDeadline();
            },
            stateManager.timeConfig.agreementTime * 2 * 1000,
            "P2PManager - initial sync participant deadline"
        );
    }

    private expireInitialSyncDeadline(): void {
        const stateManager = this.stateManager;
        this.isInitialSyncDeadlineHeld = false;
        if (stateManager.status !== Status.OPENED) {
            this.settleInitialSync(isEngagedStatus(this.stateManager.status));
            return;
        }
        if (this.participantChecksInFlight > 0) {
            this.isInitialSyncDeadlineHeld = true;
            return;
        }
        this.logger.warn(
            "No participant could serve the initial sync within its window; aborting"
        );
        stateManager.abort();
        this.settleInitialSync(false);
    }

    private cancelInitialSyncDeadline(): void {
        this.isInitialSyncDeadlineHeld = false;
        if (!this.initialSyncDeadline) return;
        this.stateManager.timeoutManager.cancelTask(this.initialSyncDeadline);
        this.initialSyncDeadline = undefined;
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
            this.notifyConnectionsChanged();
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
            // A proven peer is excluded by identity. For an unproven transport
            // only a profile attached to it is marked; with no profile nothing
            // is recorded, and the close below is the only effect.
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

        // A reply matches its request by peer address, so a request pending on
        // this transport stays pending on another live transport of the same
        // peer (the replacement after a transport upgrade). Only a peer with no
        // other live transport rejects it.
        const peerProfile =
            profile ??
            (transport.peerAddress
                ? this.profileManager.getProfileByEvmAddress(
                      transport.peerAddress as Address
                  )
                : undefined);
        const replacement = peerProfile
            ?.getLiveTransports()
            .find((live) => live !== transport);
        if (replacement)
            this.rpcRouter.movePendingRpcRequests(transport, replacement);
        else
            this.rpcRouter.rejectPendingRpcRequestsForTransport(
                transport,
                new Error("Peer disconnected before RPC response arrived")
            );

        const wasOpen = this.openConnections.includes(transport);
        this.openConnections = this.openConnections.filter(
            (t) => t !== transport
        );
        if (wasOpen) this.notifyConnectionsChanged();
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
     */
    public getConnectedPeers(): Set<Address> {
        return new Set<Address>(
            this.getOpenConnections().map(({ peerAddress }) => peerAddress)
        );
    }

    /**
     * Returns a snapshot of the active connections with their transport
     * types. A transport's peer address is resolved from the transport first,
     * then from its registered profile; an unidentified transport is left out.
     */
    public getOpenConnections(): OpenConnection[] {
        const connections: OpenConnection[] = [];
        for (const transport of this.openConnections) {
            const fromTransport = transport.peerAddress;
            const peerAddress = fromTransport
                ? // Boundary: transport.peerAddress can originate outside ethers.
                  getChecksumAddress(fromTransport)
                : this.profileManager
                      .getProfileByTransport(transport)
                      ?.getEvmAddress()
                      ?.toString();
            if (peerAddress)
                connections.push({
                    peerAddress,
                    transportType: transport.transportType
                });
        }
        return connections;
    }

    private notifyConnectionsChanged(): void {
        this.stateManager.p2pEventHooks.onConnectionsChanged?.(
            this.getOpenConnections()
        );
    }
}

export default P2PManager;
