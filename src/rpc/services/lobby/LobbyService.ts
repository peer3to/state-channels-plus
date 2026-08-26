import { ethers } from "ethers";

import ARpcService from "@/rpc/ARpcService";
import { HandshakeCompletedGuard } from "@/rpc/guards";
import type ATransport from "@/transport/ATransport";
import type { Address } from "@/types/types";
import { config } from "@/utils/config";
import { getChecksumAddress } from "@/utils/address";
import { deriveLobbyTopic } from "@/discovery/lobbyTopic";
import { LobbyAdStore, StoredAd } from "@/discovery/LobbyAdStore";
import {
    AdId,
    AdKind,
    ChannelAdStruct,
    adId as computeAdId,
    encodeChannelAd
} from "@/discovery/ChannelAd";
import {
    AdmissionMode,
    AdmissionPolicy,
    DEFAULT_ADMISSION_POLICY,
    evaluateAdmission
} from "@/discovery/AdmissionPolicy";
import { LobbyReservations, Reservation } from "@/discovery/LobbyReservations";
import type {
    IntentDeclineReason,
    ReleaseIntentResult,
    RequestIntentResult
} from "@/discovery/LobbyIntentTypes";
import OpenChannelNegotiationService from "@/rpc/services/openChannelNegotiation/OpenChannelNegotiationService";
import { getOptionalRpcService } from "@/utils/optionalRpcService";

import LobbyRpcMethods, { type LobbyP2PManager } from "./LobbyRpcMethods";

// TTL sweep cadence for published/received ads.
const AD_SWEEP_INTERVAL_MS = 1000;

// Upper bound on the requester-side wait for a requestIntent/releaseIntent
// response - see requestIntent/releaseIntent below. The effective timeout is
// min(config.LOBBY_INTENT_HOLD_MS, this cap), so it never outlives the
// acceptor's own hold by much while still being bounded even if
// LOBBY_INTENT_HOLD_MS is configured very large.
const REQUEST_TIMEOUT_CAP_MS = 10000;

// Bounds the pre-join advertise buffer (see `pendingAdvertisements`) - an
// authenticated peer that races our own joinLobby() can only ever fill this
// many slots before later ones are dropped, never grow it unboundedly.
const MAX_PENDING_ADVERTISEMENTS = 64;

const VALID_ADMISSION_MODES: ReadonlySet<AdmissionMode> =
    new Set<AdmissionMode>(["allowAll", "denyAll", "arbitrate"]);

/**
 * Opt-in custom RPC service for channel discovery. Rather than standing up
 * its own transport, this rides the SAME shared Hyperswarm/Holepunch stack
 * every other transport uses: `joinLobby` just calls
 * `p2pManager.holepunch.join(topic)`, and every resulting connection goes
 * through the ordinary `InitHandshakeService` handshake. That handshake no
 * longer promotes a peer into the channel broadcast set by itself
 * (`P2PManager.onHandshakeCompleted` only promotes dispute participants /
 * accepted spectators) - so a lobby peer met this way is authenticated and
 * reachable by targeted RPC (via `ProfileManager`) but never receives
 * channel broadcasts. That guarantee is what makes collapsing the lobby's
 * own auth/framing/transport stack into a plain RPC service safe.
 *
 * State (ad store, reservations, admission policy) lives here; the wire
 * surface is `LobbyRpcMethods`, reachable only once `HandshakeCompletedGuard`
 * passes.
 */
export default class LobbyService extends ARpcService<
    LobbyRpcMethods,
    LobbyP2PManager
> {
    // Declarative admission policy consulted at requestIntent, acceptor
    // side. Never settable from LobbyRpcMethods - a remote peer setting our
    // own admission policy would be a trivial takeover.
    public admissionPolicy: AdmissionPolicy = DEFAULT_ADMISSION_POLICY;

    // Constructed lazily, on the first joinLobby() - the app namespace (and
    // therefore LobbyAdStore's expectedApp) isn't known before then.
    private adStore?: LobbyAdStore;
    private reservations?: LobbyReservations;
    /** adIds this instance itself published (advertiser === our own address). */
    private readonly ownPublishedAdIds = new Set<AdId>();
    /**
     * Peers we've exchanged lobby traffic with (handshaked while joined, or
     * that reached us with an advertise/withdraw/requestIntent). Used only
     * to fan out publishAd/withdrawAd - NEVER the channel promotion set
     * (that remains P2PManager.openConnections, untouched by this service).
     */
    private readonly knownPeers = new Set<string>();
    /**
     * A peer we're already handshake-connected to can send us "advertise"
     * before we've called our OWN joinLobby() - the guard only checks
     * handshake completion, not local join state, and there is no wire-level
     * ordering guarantee between "peer A publishes" and "peer B joins its
     * own lobby". Buffered (bounded) here and replayed once we do join,
     * rather than silently dropped.
     */
    private readonly pendingAdvertisements: {
        peerAddress: string;
        encodedAd: string;
    }[] = [];
    private appNamespace?: string;
    private topic?: Buffer;
    private sweepIntervalHandle?: ReturnType<typeof setInterval>;
    private unsubscribeHandshakeCompleted?: () => void;
    private unsubscribeDisconnection?: () => void;

    constructor(p2pManager: LobbyP2PManager) {
        super(
            p2pManager,
            p2pManager.stateManager.logger.child({ component: "LobbyService" })
        );
        this.guards = [new HandshakeCompletedGuard(this)];
    }

    public createRPCMethods(transport: ATransport): LobbyRpcMethods {
        return new LobbyRpcMethods(transport, this);
    }

    // ---- local facade (mirrors the old DiscoveryFacade surface) ---------

    /**
     * Joins the shared swarm's lobby topic. Idempotent: a join after a
     * prior join/leave (or a bare double join) never orphans the previous
     * sweeper interval or handshake subscription. The app namespace is
     * fixed on the FIRST call for this instance's lifetime - a later call
     * naming a different namespace throws rather than silently switching.
     */
    public async joinLobby(
        appNamespaceOverride?: string
    ): Promise<{ topic: string }> {
        if (
            this.appNamespace !== undefined &&
            appNamespaceOverride !== undefined &&
            appNamespaceOverride !== this.appNamespace
        ) {
            throw new Error(
                `Discovery lobby is already joined with appNamespace "${this.appNamespace}"; cannot rejoin with a different namespace "${appNamespaceOverride}" on this instance (the lobby's namespace is fixed at first join - leaveLobby() rejoins the SAME topic, it does not switch namespaces)`
            );
        }

        if (this.appNamespace === undefined) {
            const appNamespace = this.resolveAppNamespace(appNamespaceOverride);
            const [network, rawStateChannelManagerAddress] = await Promise.all([
                this.p2pManager.stateManager.signer.provider!.getNetwork(),
                this.p2pManager.stateManager.stateChannelManagerContract.getAddress()
            ]);
            const stateChannelManagerAddress = String(
                rawStateChannelManagerAddress
            );
            this.appNamespace = appNamespace;
            this.adStore = new LobbyAdStore({
                now: Date.now,
                expectedApp: appNamespace,
                logger: this.logger,
                maxAdsPerPeer: config.LOBBY_MAX_ADS_PER_PEER,
                maxOpenAdsPerPeer: config.LOBBY_MAX_OPEN_ADS_PER_PEER,
                maxAds: config.LOBBY_MAX_ADS
            });
            this.reservations = new LobbyReservations({
                now: Date.now,
                holdMs: config.LOBBY_INTENT_HOLD_MS,
                onExpire: (reservation) =>
                    this.onReservationExpired(reservation)
            });
            this.topic = deriveLobbyTopic({
                chainId: network.chainId,
                stateChannelManagerAddress,
                appNamespace
            });

            // Replay any "advertise" that raced our own join above.
            const buffered = this.pendingAdvertisements.splice(0);
            for (const { peerAddress, encodedAd } of buffered) {
                this.acceptAdvertise(peerAddress, encodedAd);
            }
        }

        this.clearJoinResources();
        this.unsubscribeHandshakeCompleted =
            this.p2pManager.stateManager.events.on(
                "p2pEventHooks",
                "handshakeCompleted",
                (peerAddress) => this.onPeerHandshakeCompleted(peerAddress)
            );
        this.unsubscribeDisconnection = this.p2pManager.stateManager.events.on(
            "p2pEventHooks",
            "onDisconnection",
            (peerAddress) => this.onPeerDisconnected(peerAddress)
        );
        // Mirrors P2PManager.tryOpenConnectionToChannel: under
        // DEBUG_LOCAL_TRANSPORT the real swarm join is a no-op (a live
        // Hyperswarm/DHT socket has no business existing in a test process)
        // - the harness wires local peer discovery itself, the same way it
        // already does for a channel topic.
        if (!config.DEBUG_LOCAL_TRANSPORT) {
            await this.p2pManager.holepunch.join(this.topic!);
        }
        this.sweepIntervalHandle = setInterval(
            () => this.sweepExpiredAds(),
            AD_SWEEP_INTERVAL_MS
        );

        // The `handshakeCompleted` subscription above only catches FUTURE
        // handshakes - a peer already connected (e.g. an existing channel
        // participant who also opts into the lobby) completed its
        // handshake before we subscribed, so it needs to be treated as
        // known right away rather than only being discovered on some LATER
        // reconnect.
        for (const address of this.p2pManager.getHandshakeCompletedPeers()) {
            this.onPeerHandshakeCompleted(address);
        }

        const hexTopic = this.topic!.toString("hex");
        this.logger.info("Joined lobby", {
            topic: hexTopic,
            appNamespace: this.appNamespace
        });
        this.p2pManager.stateManager.events.emit("discovery", "lobbyJoined", [
            { topic: hexTopic, appNamespace: this.appNamespace }
        ]);
        return { topic: hexTopic };
    }

    /** Leaves the shared swarm's lobby topic. A later joinLobby() rejoins the SAME topic. */
    public async leaveLobby(): Promise<void> {
        if (this.topic === undefined) return;
        const hexTopic = this.topic.toString("hex");
        const topic = this.topic;
        // Withdraw every ad we've published so peers we leave behind don't
        // keep stale ads visible until TTL. Because the lobby rides the
        // shared swarm, leaving this topic does NOT tear down the underlying
        // connection (it may still be in use for something else) - there is
        // no "transport closed" signal to drop these on, so we announce the
        // withdrawal ourselves instead.
        for (const adId of [...this.ownPublishedAdIds]) {
            this.broadcastToKnownPeers((peer) =>
                this.remoteRpc.lobbyService.withdraw(adId).sendOne(peer)
            );
        }
        this.clearJoinResources();
        await this.p2pManager.holepunch.leave(topic);
        this.p2pManager.stateManager.events.emit("discovery", "lobbyLeft", [
            { topic: hexTopic }
        ]);
    }

    /**
     * `advertiser` is always OUR OWN authenticated address, never a
     * caller-supplied value - mirrors the receive-side rule (LobbyAdStore
     * only ever admits advertiser === authenticatedPeer).
     */
    public async publishAd(ad: ChannelAdStruct): Promise<{ adId: AdId }> {
        const adStore = this.requireAdStore();
        const address = this.ownAddress();
        const normalizedAd: ChannelAdStruct = { ...ad, advertiser: address };
        const { encodedAd } = encodeChannelAd(normalizedAd);
        const result = adStore.accept({
            encodedAd,
            authenticatedPeer: address
        });
        if (!result.ok) {
            throw new Error(`publishAd rejected: ${result.reason}`);
        }
        if (result.superseded !== undefined) {
            this.ownPublishedAdIds.delete(result.superseded);
        }
        if (result.evicted !== undefined) {
            this.ownPublishedAdIds.delete(result.evicted);
        }
        this.ownPublishedAdIds.add(result.adId);
        this.p2pManager.stateManager.events.emit("discovery", "ad", [
            { adId: result.adId, encodedAd, advertiser: address }
        ]);
        this.broadcastToKnownPeers((peer) =>
            this.remoteRpc.lobbyService.advertise(encodedAd).sendOne(peer)
        );
        return { adId: result.adId };
    }

    public async withdrawAd(adId: AdId): Promise<void> {
        const adStore = this.requireAdStore();
        const address = this.ownAddress();
        const result = adStore.withdraw({ adId, requester: address });
        if (!result.ok) {
            throw new Error(
                `withdrawAd failed: ${result.reason ?? "not-found"}`
            );
        }
        this.ownPublishedAdIds.delete(adId);
        this.p2pManager.stateManager.events.emit("discovery", "adExpired", [
            { adId, reason: "withdrawn" }
        ]);
        this.broadcastToKnownPeers((peer) =>
            this.remoteRpc.lobbyService.withdraw(adId).sendOne(peer)
        );
    }

    public listAds(filter?: {
        kind?: AdKind;
        minAmount?: string;
        maxAmount?: string;
    }): StoredAd[] {
        return this.requireAdStore().list(filter);
    }

    /**
     * The race primitive's requester leg: asks `peerAddress` (the
     * advertiser of `adId`, one of ITS OWN ads that we received via
     * `advertise`) for a hold on it. Resolves from the peer's RPC response -
     * never resolves locally with a synthesized decision.
     */
    public async requestIntent(args: {
        peerAddress: string;
        adId: AdId;
        amount: string;
    }): Promise<RequestIntentResult> {
        const peerAddress = getChecksumAddress(args.peerAddress);
        const stored = this.requireAdStore().get(args.adId);
        if (stored === undefined) {
            throw new Error(`requestIntent: unknown adId "${args.adId}"`);
        }
        const timeoutMs = Math.min(
            config.LOBBY_INTENT_HOLD_MS,
            REQUEST_TIMEOUT_CAP_MS
        );
        return this.remoteRpc.lobbyService
            .requestIntent(stored.encodedAd, args.amount)
            .request(peerAddress, { timeoutMs });
    }

    /**
     * releaseIntent is REQUEST/RESPONSE (ACK'd), never fire-and-forget. A
     * caller whose release goes unanswered must retry once itself and then
     * let the hold expire on its own timer - this method makes exactly one
     * round trip and never retries or closes the connection on the caller's
     * behalf.
     */
    public async releaseIntent(args: {
        peerAddress: string;
        adId: AdId;
    }): Promise<ReleaseIntentResult> {
        const peerAddress = getChecksumAddress(args.peerAddress);
        const timeoutMs = Math.min(
            config.LOBBY_INTENT_HOLD_MS,
            REQUEST_TIMEOUT_CAP_MS
        );
        return this.remoteRpc.lobbyService
            .releaseIntent(args.adId)
            .request(peerAddress, { timeoutMs });
    }

    /**
     * *Service*-only setter (never a wire endpoint - see LobbyRpcMethods,
     * which never exposes this). Rejects an unrecognized mode (fail closed)
     * and shallow-clones the policy so a caller mutating its own object
     * afterward can't retroactively change a decision already taken with it.
     */
    public setAdmissionPolicy(policy: AdmissionPolicy): void {
        if (!VALID_ADMISSION_MODES.has(policy.mode)) {
            throw new Error(
                `LobbyService.setAdmissionPolicy: unrecognized mode "${String(policy.mode)}"`
            );
        }
        this.admissionPolicy = {
            ...policy,
            allow: policy.allow ? [...policy.allow] : undefined,
            deny: policy.deny ? [...policy.deny] : undefined
        };
    }

    public async dispose(): Promise<void> {
        this.clearJoinResources();
        this.reservations?.dispose();
        this.knownPeers.clear();
        this.pendingAdvertisements.length = 0;
        if (this.topic !== undefined) {
            await this.p2pManager.holepunch.leave(this.topic);
        }
    }

    // ---- wire-side handlers (invoked by LobbyRpcMethods only) ------------

    /**
     * Resolves the authenticated sender of an inbound lobby RPC.
     * Lives here rather than on LobbyRpcMethods because that class may hold
     * only wire endpoints. `HandshakeCompletedGuard` should guarantee a
     * peerAddress is present; undefined means a broken peer, and every
     * endpoint declines rather than acting on an unattributed sender.
     */
    public resolveSenderAddress(transport: ATransport): string | undefined {
        return transport.peerAddress
            ? getChecksumAddress(transport.peerAddress)
            : undefined;
    }

    public handleAdvertise(peerAddress: string, encodedAd: string): void {
        this.knownPeers.add(peerAddress);
        if (!this.adStore) {
            // Not joined yet - the sender is already handshake-connected
            // (that's how this RPC reached us at all), it simply won the
            // race against our own joinLobby(). Buffer and replay once we
            // do join, rather than silently dropping it.
            if (
                this.pendingAdvertisements.length < MAX_PENDING_ADVERTISEMENTS
            ) {
                this.pendingAdvertisements.push({ peerAddress, encodedAd });
            }
            return;
        }
        this.acceptAdvertise(peerAddress, encodedAd);
    }

    /** Shared by the live wire path and the pre-join replay in joinLobby(). Requires this.adStore to already be set. */
    private acceptAdvertise(peerAddress: string, encodedAd: string): void {
        const result = this.adStore!.accept({
            encodedAd,
            authenticatedPeer: peerAddress
        });
        if (!result.ok) {
            // Rejecting an ad is never punitive - the connection survives.
            this.logger.debug("Rejected inbound lobby ad", {
                reason: result.reason,
                from: peerAddress
            });
            return;
        }
        const stored = this.adStore!.get(result.adId);
        if (stored) {
            this.p2pManager.stateManager.events.emit("discovery", "ad", [
                {
                    adId: result.adId,
                    encodedAd: stored.encodedAd,
                    advertiser: stored.ad.advertiser
                }
            ]);
        }
    }

    public handleWithdraw(peerAddress: string, adId: string): void {
        this.knownPeers.add(peerAddress);
        if (!this.adStore) return;
        const result = this.adStore.withdraw({
            adId: adId as AdId,
            requester: peerAddress
        });
        if (result.ok) {
            this.p2pManager.stateManager.events.emit("discovery", "adExpired", [
                { adId, reason: "withdrawn" }
            ]);
        }
        // not-owner / not-found: silently ignored, never punitive.
    }

    /**
     * Admission consult BEFORE reserving anything, OPEN binding (only at
     * accept, never at publish), and the "busy" race primitive (at most one
     * hold at a time). We are the ACCEPTOR - the ad named here must be one
     * WE currently publish.
     */
    public async handleRequestIntent(
        peerAddress: string,
        encodedAd: string,
        amount: string
    ): Promise<RequestIntentResult> {
        this.knownPeers.add(peerAddress);
        if (!this.adStore || !this.reservations) {
            return this.decline("policy");
        }

        let requestedAdId: AdId;
        try {
            requestedAdId = computeAdId(encodedAd);
        } catch {
            return this.decline("full");
        }

        // The ad must be one WE (still) publish - a stale/withdrawn/expired
        // ad declines "full", never "policy" or an accept, regardless of
        // what the wire bytes claim.
        const stored = this.adStore.get(requestedAdId);
        if (
            stored === undefined ||
            !this.ownPublishedAdIds.has(requestedAdId)
        ) {
            return this.decline("full", requestedAdId);
        }

        // SECURITY/CORRECTNESS: checked BEFORE admission - a hold already in
        // progress must never be disturbed by evaluating a competitor's
        // terms, and never queued or silently overwritten.
        if (this.reservations.current !== undefined) {
            return this.decline("busy", requestedAdId);
        }

        const decision = evaluateAdmission(this.admissionPolicy, {
            kind: "intent",
            peerAddress,
            amount,
            channelId: stored.ad.channelId,
            encodedAd
        });
        if (!decision.allow) {
            return this.decline(decision.reason, requestedAdId);
        }

        const reserved = this.reservations.reserve({
            adId: requestedAdId,
            peerAddress,
            channelId: stored.ad.channelId,
            kind: stored.ad.kind
        });
        if (!reserved.ok) {
            // Race: a competitor's reserve() landed between the busy check
            // above and here.
            return this.decline("busy", requestedAdId);
        }

        // This accept binds NO FUNDS on the acceptor's own side beyond what
        // it commits below - the acquirer's stake is set later via
        // setStakeAmount on ITS OWN commit path. But for an OPEN ad,
        // accepting DOES bind our own instance state (the proposed
        // channelId + this hold) for the hold duration - and ONLY now, at
        // accept time, never at publish time.
        if (stored.ad.kind === AdKind.OPEN) {
            this.applyOwnOpenAdStake(String(stored.ad.amount));
        }

        const result: RequestIntentResult = {
            accepted: true,
            holdMs: reserved.holdMs,
            channelId: stored.ad.channelId
        };
        // The advertiser's "a peer is taking my table" signal.
        this.p2pManager.stateManager.events.emit("discovery", "intentResult", [
            { adId: requestedAdId, accepted: true, holdMs: reserved.holdMs }
        ]);
        return result;
    }

    /**
     * ACK'd, never fire-and-forget. Only the peer actually holding the
     * reservation may release it - a release from anyone else, or for an
     * adId we are not holding, is a no-op ack (`released: false`), never
     * disturbs someone else's hold and never throws.
     */
    public async handleReleaseIntent(
        peerAddress: string,
        adId: string
    ): Promise<ReleaseIntentResult> {
        if (!this.reservations) return { released: false };
        const current = this.reservations.current;
        const isHolder =
            current !== undefined &&
            current.adId === adId &&
            current.peerAddress === peerAddress;
        const released = isHolder && this.reservations.release(adId as AdId);
        return { released };
    }

    // ---- internal helpers -------------------------------------------------

    private ownAddress(): string {
        return getChecksumAddress(
            String(this.p2pManager.stateManager.signerAddress)
        );
    }

    /**
     * Advertiser side of the OPEN negotiation stake: when we accept an
     * inbound intent on our own OPEN ad, set OUR stake from the ad's
     * advertised amount - the acquirer sets its own separately, via
     * ChannelAcquisitionCoordinator's commit path. A safe no-op if the
     * negotiation service isn't configured (JOIN-only / opt-in case) or the
     * amount isn't a positive safe integer - never throws.
     */
    private applyOwnOpenAdStake(amountDecimalString: string): void {
        const negotiationService = this.getNegotiationService();
        if (negotiationService === undefined) return;
        const stakeAmountNumber = Number(amountDecimalString);
        if (
            !Number.isSafeInteger(stakeAmountNumber) ||
            stakeAmountNumber <= 0
        ) {
            this.logger.warn(
                `LobbyService: skipping own-OPEN-ad stake set, invalid amount "${amountDecimalString}"`
            );
            return;
        }
        negotiationService.setStakeAmount(stakeAmountNumber);
    }

    /** Resolves the opt-in negotiation service, or undefined when none is wired. */
    private getNegotiationService(): OpenChannelNegotiationService | undefined {
        return getOptionalRpcService(
            this.p2pManager.localRpc,
            "openChannelNegotiationService",
            OpenChannelNegotiationService
        );
    }

    /**
     * config.LOBBY_APP_NAMESPACE when non-empty, otherwise the state-machine
     * contract address. ONE resolution site - do not duplicate this
     * elsewhere.
     */
    private resolveAppNamespace(override?: string): string {
        if (override) return override;
        if (config.LOBBY_APP_NAMESPACE) return config.LOBBY_APP_NAMESPACE;
        // ChannelAdStruct.app is bytes32 (ChannelAdEthersType) - a raw
        // 20-byte address would fail Codec.encode, so left-pad it exactly
        // the way Solidity's `bytes32(uint256(uint160(address)))` does.
        return ethers.zeroPadValue(
            this.p2pManager.stateManager.diamondStateMachine
                .getStateMachineAddress()
                .toString(),
            32
        );
    }

    private requireAdStore(): LobbyAdStore {
        if (!this.adStore) {
            throw new Error(
                "Discovery lobby is not joined; call joinLobby() first"
            );
        }
        return this.adStore;
    }

    /** Clears the TTL sweeper interval and the handshake/disconnection subscriptions, if any. */
    private clearJoinResources(): void {
        if (this.sweepIntervalHandle !== undefined) {
            clearInterval(this.sweepIntervalHandle);
            this.sweepIntervalHandle = undefined;
        }
        this.unsubscribeHandshakeCompleted?.();
        this.unsubscribeHandshakeCompleted = undefined;
        this.unsubscribeDisconnection?.();
        this.unsubscribeDisconnection = undefined;
    }

    private sweepExpiredAds(): void {
        if (!this.adStore) return;
        const removed = this.adStore.sweep();
        for (const adId of removed) {
            this.ownPublishedAdIds.delete(adId);
            this.p2pManager.stateManager.events.emit("discovery", "adExpired", [
                { adId, reason: "ttl" }
            ]);
        }
    }

    /**
     * Every handshake completed on the SHARED swarm fires this hook -
     * channel peers included, not just lobby ones (Holepunch has no
     * per-connection topic tag to filter on). Pushing our own ads to a peer
     * that doesn't run this service is safe in practice: the lobby topic is
     * derived from (chainId, stateChannelManagerAddress, appNamespace), so
     * only another instance of the SAME app deployment - which shares the
     * SAME custom RPC manifest, lobbyService included - is ever discovered
     * through it.
     */
    private onPeerHandshakeCompleted(peerAddress: Address): void {
        if (!this.adStore) return; // not joined
        const address = getChecksumAddress(peerAddress);
        this.knownPeers.add(address);
        for (const adId of this.ownPublishedAdIds) {
            const stored = this.adStore.get(adId);
            if (!stored) continue; // withdrawn/expired meanwhile
            this.sendToKnownPeer(address, () =>
                this.remoteRpc.lobbyService
                    .advertise(stored.encodedAd)
                    .sendOne(address)
            );
        }
        this.p2pManager.stateManager.events.emit("discovery", "lobbyPeer", [
            { address, connected: true, peerCount: this.knownPeers.size }
        ]);
    }

    /**
     * Connection-scoped freshness (the strongest tier): drops every ad
     * from `peerAddress`
     * once it is no longer reachable. `onDisconnection` (like
     * `handshakeCompleted`) fires for ANY unexpected close on this
     * P2PManager, not just a lobby peer's - re-checking reachability via
     * `ProfileManager` before dropping guards the same same-address
     * reconnect race the old per-connection bookkeeping did: a stale
     * transport's close must never evict a peer that is still reachable
     * over a fresher one.
     */
    private onPeerDisconnected(peerAddress: Address): void {
        if (!this.adStore) return;
        const address = getChecksumAddress(peerAddress);
        const stillReachable =
            this.p2pManager.profileManager.getTransportByEvmAddress(address);
        if (stillReachable && !stillReachable.isClosed) return;
        this.knownPeers.delete(address);
        const removedIds = this.adStore.dropByPeer(address);
        for (const adId of removedIds) {
            this.p2pManager.stateManager.events.emit("discovery", "adExpired", [
                { adId, reason: "peer-disconnected" }
            ]);
        }
        this.p2pManager.stateManager.events.emit("discovery", "lobbyPeer", [
            { address, connected: false, peerCount: this.knownPeers.size }
        ]);
    }

    /** Fans `send` out to every known peer, dropping one from the set if delivery throws. */
    private broadcastToKnownPeers(send: (peerAddress: string) => void): void {
        for (const peer of [...this.knownPeers]) {
            this.sendToKnownPeer(peer, () => send(peer));
        }
    }

    private sendToKnownPeer(peerAddress: string, send: () => void): void {
        try {
            send();
        } catch (error) {
            this.logger.debug(
                "Lobby: failed to reach a known peer; dropping it from the known-peer set",
                {
                    peerAddress,
                    error:
                        error instanceof Error ? error.message : String(error)
                }
            );
            this.knownPeers.delete(peerAddress);
        }
    }

    private decline(
        reason: IntentDeclineReason,
        requestedAdId?: AdId
    ): RequestIntentResult {
        this.p2pManager.stateManager.events.emit("discovery", "intentResult", [
            { adId: requestedAdId ?? "", accepted: false, reason }
        ]);
        return { accepted: false, reason };
    }

    /** Fired by LobbyReservations when a hold expires with no release/commit. */
    private onReservationExpired(reservation: Reservation): void {
        this.logger.debug("Lobby intent hold expired", {
            adId: reservation.adId,
            peerAddress: reservation.peerAddress
        });
    }

}
