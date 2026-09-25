import LobbyMatchingRpcMethods from "./LobbyMatchingRpcMethods";
import type {
    LobbyAvailability,
    LobbyCommitResult,
    LobbyMatch,
    LobbyMatchingServiceOptions,
    LobbyPickResult,
    LobbyRole,
    RoleEpoch
} from "./LobbyMatchingTypes";
import { validateMatchTimeout } from "./LobbyMatchingValidation";
import LobbyRpcAdmissionGuard from "./LobbyRpcAdmissionGuard";
import { DisconnectPolicy } from "@/DisconnectPolicy";
import type P2PManager from "@/P2PManager";
import ANetworkRpcService from "@/rpc/network/ANetworkRpcService";
import { HandshakeCompletedGuard } from "@/rpc/network/guards";
import { compareAddresses } from "@/rpc/network/services/openChannelNegotiation/OpenChannelNegotiationHelpers";
import type Rpc from "@/rpc/Rpc";
import { RPC_GUARD_REJECTION_ERROR } from "@/rpc/Rpc";
import type NetworkTransport from "@/transport/NetworkTransport";
import { Status } from "@/types";
import type { Address } from "@/types/types";
import { requireBytes32 } from "@/utils/bytes32";
import { errorMessage } from "@/utils/errorMessage";

import { ethers, ZeroHash } from "ethers";

type Candidate = {
    transport: NetworkTransport;
    roleEpoch: RoleEpoch;
    unsubscribeDisconnected: () => void;
};

type Selection = {
    peerAddress: Address;
    transport: NetworkTransport;
    attemptNonce: string;
    roleEpoch: number;
    selectorChallenge: string;
    unsubscribeDisconnected?: () => void;
};

type Reservation = Selection & {
    advertiserChallenge: string;
    expiry: ReturnType<typeof setTimeout>;
};

const DEFAULT_ROLE_MIN_MS = 1000;
const DEFAULT_ROLE_MAX_MS = 2000;
const MAX_REJECTED_RPCS_PER_TRANSPORT = 8;

export default class LobbyMatchingService extends ANetworkRpcService<LobbyMatchingRpcMethods> {
    private readonly roleDurationMinMs: number;
    private readonly roleDurationMaxMs: number;
    private readonly shouldMatchPeer: (peerAddress: Address) => boolean;
    private readonly candidates = new Map<Address, Candidate>();
    /** Latest role epoch accepted from each authenticated peer. */
    private readonly peerRoleEpochs = new Map<Address, RoleEpoch>();
    /** Rejected lobby RPC count for each transport during this service life. */
    private readonly rejectedRpcCounts = new WeakMap<
        NetworkTransport,
        number
    >();
    private readonly neutralProfileLosses = new Set<Address>();
    /** Authenticated transports owned only by the active lobby session. */
    private readonly sessionTransports = new Map<
        NetworkTransport,
        () => void
    >();
    /** Selected transports promoted for negotiation and closed on retry. */
    private readonly handedOffTransports = new Set<NetworkTransport>();
    /** Selected profile that may add replacement transports during handoff. */
    private handedOffPeerAddress?: Address;
    private activeTopic?: string;
    /** Lobby topic this session joined and has not left yet. */
    private joinedTopic?: string;
    private role: LobbyRole = "none";
    private roleEpoch = 0;
    private inFlightSelection?: Selection;
    private reservation?: Reservation;
    private roleTimer?: ReturnType<typeof setTimeout>;
    private matchTimer?: ReturnType<typeof setTimeout>;
    private deferredRoleSwitch = false;
    private exhaustionSwitchScheduled = false;
    private matchResolve?: (match: LobbyMatch | undefined) => void;
    /** The cleanup still running, so a new session cannot start under it. */
    private cleanupInFlight?: Promise<void>;
    // Sessions waiting for that cleanup to finish. The caller of a waiting
    // session already set the status it wants; the cleanup must not reset it.
    private matchesWaitingForCleanup = 0;
    private commitInFlight = false;
    private pendingCancellation?: {
        promise: Promise<boolean>;
        resolve: (cancelled: boolean) => void;
    };
    private observedTargetChannelId?: string;
    private unsubscribeTargetOpened?: () => void;

    constructor(
        p2pManager: P2PManager,
        options: LobbyMatchingServiceOptions = {}
    ) {
        super(
            p2pManager.rpcRouter,
            p2pManager.stateManager.logger.child({
                component: "LobbyMatchingService"
            })
        );
        this.roleDurationMinMs =
            options.roleDurationMinMs ?? DEFAULT_ROLE_MIN_MS;
        this.roleDurationMaxMs =
            options.roleDurationMaxMs ?? DEFAULT_ROLE_MAX_MS;
        this.shouldMatchPeer = options.shouldMatchPeer ?? (() => true);
        if (
            this.roleDurationMinMs <= 0 ||
            this.roleDurationMaxMs < this.roleDurationMinMs
        ) {
            throw new Error("Invalid lobby role-duration bounds");
        }
        this.guards = [
            new HandshakeCompletedGuard(this),
            new LobbyRpcAdmissionGuard(this)
        ];
    }

    public createRPCMethods(
        transport: NetworkTransport
    ): LobbyMatchingRpcMethods {
        return new LobbyMatchingRpcMethods(transport, this);
    }

    public async match(
        topic: string,
        matchTimeoutMs?: number | null,
        observedTargetChannelId?: string
    ): Promise<LobbyMatch | undefined> {
        const normalizedTopic = this.validateTopic(topic);
        const normalizedTimeout = validateMatchTimeout(matchTimeoutMs);
        const normalizedTarget = observedTargetChannelId
            ? this.validateTopic(observedTargetChannelId)
            : undefined;

        // A cleanup that is still awaiting its topic leave owns the session
        // transports it is about to close; a session started under it would
        // lose them and its status to that cleanup.
        this.matchesWaitingForCleanup += 1;
        try {
            await this.cleanupInFlight;
            if (this.activeTopic && !this.matchResolve) {
                throw new Error(
                    "Lobby matching already handed off to channel negotiation"
                );
            }
            if (this.activeTopic) await this.cleanup();
        } finally {
            this.matchesWaitingForCleanup -= 1;
        }
        return this.startMatching(
            normalizedTopic,
            normalizedTimeout,
            normalizedTarget
        );
    }

    public async cancelMatching(topic: string): Promise<boolean> {
        const normalizedTopic = this.validateTopic(topic);
        if (normalizedTopic !== this.activeTopic || !this.matchResolve) {
            return false;
        }
        if (this.commitInFlight) {
            if (this.pendingCancellation) {
                return this.pendingCancellation.promise;
            }
            let resolve!: (cancelled: boolean) => void;
            const promise = new Promise<boolean>((settle) => {
                resolve = settle;
            });
            this.pendingCancellation = { promise, resolve };
            return promise;
        }
        await this.cleanup();
        return true;
    }

    /** Ends topic membership after negotiation has reached an opened channel. */
    public async completeLobby(topic: string): Promise<void> {
        const normalizedTopic = this.validateTopic(topic);
        if (normalizedTopic !== this.activeTopic || this.matchResolve) return;
        if (this.handedOffPeerAddress) {
            this.p2pManager.promoteLobbyConnections(
                this.handedOffTransports,
                this.handedOffPeerAddress
            );
        }
        await this.cleanup({ preserveHandedOffTransports: true });
    }

    /** Releases the selected transport after an unsigned negotiation failure. */
    public async releaseNegotiationHandoff(topic: string): Promise<void> {
        const normalizedTopic = this.validateTopic(topic);
        if (normalizedTopic !== this.activeTopic || this.matchResolve) return;
        await this.cleanup();
    }

    public get rendezvousTopic(): string | undefined {
        return this.activeTopic;
    }

    public ownsNegotiationPeer(transport: NetworkTransport): boolean {
        const peerAddress = this.peerAddress(transport);
        return (
            !!peerAddress &&
            !this.matchResolve &&
            this.handedOffPeerAddress === peerAddress
        );
    }

    public takeObservedTargetOpen(channelId: string): boolean {
        const normalizedChannelId = this.validateTopic(channelId);
        if (this.observedTargetChannelId !== normalizedChannelId) return false;
        this.observedTargetChannelId = undefined;
        return true;
    }

    public getAvailability(): {
        topic?: string;
        topicJoined: boolean;
        role: LobbyRole;
        roleEpoch: number;
        candidateCount: number;
        matching: boolean;
        inFlight: boolean;
        reserved: boolean;
    } {
        return {
            topic: this.activeTopic,
            topicJoined: !!this.joinedTopic,
            role: this.role,
            roleEpoch: this.roleEpoch,
            candidateCount: this.candidates.size,
            matching: !!this.matchResolve,
            inFlight: !!this.inFlightSelection,
            reserved: !!this.reservation
        };
    }

    public async dispose(): Promise<void> {
        await this.cleanup();
    }

    /** Disconnects every transport owned by matching or its selected handoff. */
    public disconnectLobbyTransports(): number {
        const count =
            this.sessionTransports.size + this.handedOffTransports.size;
        this.disconnectSessionTransports();
        this.disconnectHandedOffTransports();
        return count;
    }

    public isRpcAdmitted(rpc: Rpc): boolean {
        if (
            typeof rpc.params[0] !== "string" ||
            rpc.params[0] !== this.activeTopic
        ) {
            return false;
        }
        if (rpc.method === "pick" || rpc.method === "commit") return true;
        return rpc.method === "advertise" && !!this.matchResolve;
    }

    public recordRejectedRpc(transport: NetworkTransport): void {
        const count = (this.rejectedRpcCounts.get(transport) ?? 0) + 1;
        this.rejectedRpcCounts.set(transport, count);
        if (count > MAX_REJECTED_RPCS_PER_TRANSPORT) {
            this.p2pManager.disconnectConnection(
                transport,
                DisconnectPolicy.BLACKLIST,
                "repeated rejected lobby traffic"
            );
        }
    }

    public onAuthenticatedTransport(transport: NetworkTransport): void {
        if (transport.isClosed) return;
        const peerAddress = this.peerAddress(transport);
        const handedOffPeerAddress = this.handedOffPeerAddress;
        if (
            this.activeTopic &&
            !this.matchResolve &&
            handedOffPeerAddress &&
            peerAddress === handedOffPeerAddress
        ) {
            if (this.handedOffTransports.has(transport)) return;
            this.handedOffTransports.add(transport);
            return;
        }
        if (!this.activeTopic || !this.matchResolve) {
            this.p2pManager.disconnectConnection(
                transport,
                DisconnectPolicy.ALLOW
            );
            return;
        }
        if (!this.sessionTransports.has(transport)) {
            const unsubscribe = transport.onClosed(() => {
                this.sessionTransports.delete(transport);
                this.handedOffTransports.delete(transport);
            });
            this.sessionTransports.set(transport, unsubscribe);
        }
        this.sendAvailability(transport);
    }

    /** True after this exact transport was promoted for matched negotiation. */
    public isHandedOffTransport(transport: NetworkTransport): boolean {
        return this.handedOffTransports.has(transport);
    }

    public receiveAvailability(
        transport: NetworkTransport,
        availability: LobbyAvailability
    ): void {
        const peerAddress = this.peerAddress(transport);
        if (
            !peerAddress ||
            availability.topic !== this.activeTopic ||
            !this.isValidRole(availability.role) ||
            !Number.isSafeInteger(availability.roleEpoch) ||
            availability.roleEpoch < 0 ||
            typeof availability.available !== "boolean" ||
            !this.isMatchablePeer(peerAddress)
        ) {
            return;
        }

        const latestRoleEpoch = this.peerRoleEpochs.get(peerAddress);
        if (
            latestRoleEpoch !== undefined &&
            availability.roleEpoch < latestRoleEpoch
        ) {
            return;
        }
        const candidate = this.candidates.get(peerAddress);
        const isAvailableAdvertiser =
            availability.role === "advertiser" && availability.available;
        if (availability.roleEpoch === latestRoleEpoch) {
            if (
                isAvailableAdvertiser &&
                candidate?.transport === transport &&
                candidate.roleEpoch === availability.roleEpoch
            ) {
                return;
            }
            if (!isAvailableAdvertiser && !candidate) return;
        }
        this.peerRoleEpochs.set(peerAddress, availability.roleEpoch);
        this.bootstrapRole(peerAddress, availability.role);
        this.removeCandidate(peerAddress);

        if (isAvailableAdvertiser) {
            const profile =
                this.p2pManager.profileManager.getProfileByEvmAddress(
                    peerAddress
                );
            if (!profile) return;
            this.candidates.set(peerAddress, {
                transport,
                roleEpoch: availability.roleEpoch,
                unsubscribeDisconnected: profile.onDisconnected(() =>
                    this.onProfileDisconnected(peerAddress)
                )
            });
            if (this.exhaustionSwitchScheduled) {
                this.exhaustionSwitchScheduled = false;
                this.scheduleRoleSwitch();
            }
        }
        if (this.role === "selector") void this.selectNextCandidate();
    }

    public receivePick(
        transport: NetworkTransport,
        attemptNonce: string,
        roleEpoch: number,
        selectorChallenge: string
    ): LobbyPickResult {
        const peerAddress = this.peerAddress(transport);
        if (
            !peerAddress ||
            !this.isMatchablePeer(peerAddress) ||
            this.role !== "advertiser" ||
            !Number.isSafeInteger(roleEpoch) ||
            roleEpoch !== this.roleEpoch ||
            !ethers.isHexString(attemptNonce, 32) ||
            attemptNonce === ZeroHash ||
            !ethers.isHexString(selectorChallenge, 32) ||
            selectorChallenge === ZeroHash
        ) {
            return { status: "rejected" };
        }
        if (this.reservation) return { status: "busy" };

        const advertiserChallenge = this.randomBytes32();
        const profile =
            this.p2pManager.profileManager.getProfileByEvmAddress(peerAddress);
        if (!profile) return { status: "rejected" };
        const expiry = this.p2pManager.stateManager.timeoutManager.scheduleTask(
            () => this.expireReservation(peerAddress),
            this.p2pManager.stateManager.timeConfig.agreementTime * 1000,
            "lobby advertiser reservation expiry"
        );
        this.reservation = {
            peerAddress,
            transport,
            attemptNonce,
            roleEpoch,
            selectorChallenge,
            advertiserChallenge,
            unsubscribeDisconnected: profile.onDisconnected(() =>
                this.onProfileDisconnected(peerAddress)
            ),
            expiry
        };
        return {
            status: "accepted",
            advertiserChallenge,
            roleEpoch
        };
    }

    public receiveCommit(
        transport: NetworkTransport,
        attemptNonce: string,
        roleEpoch: number,
        selectorChallenge: string,
        advertiserChallenge: string
    ): LobbyCommitResult {
        const reservation = this.reservation;
        const peerAddress = this.peerAddress(transport);
        if (
            !reservation ||
            !peerAddress ||
            !this.isMatchablePeer(peerAddress) ||
            reservation.peerAddress !== peerAddress ||
            reservation.attemptNonce !== attemptNonce ||
            reservation.roleEpoch !== roleEpoch ||
            reservation.selectorChallenge !== selectorChallenge ||
            reservation.advertiserChallenge !== advertiserChallenge
        ) {
            return { status: "rejected" };
        }
        this.p2pManager.stateManager.timeoutManager.cancelTask(
            reservation.expiry
        );
        reservation.unsubscribeDisconnected?.();
        this.reservation = undefined;
        void this.finishMatch({
            peerAddress,
            attemptNonce,
            selectorAddress: peerAddress,
            advertiserAddress:
                this.p2pManager.stateManager.checksumSignerAddress,
            selectorChallenge,
            advertiserChallenge
        });
        return { status: "acknowledged" };
    }

    private bootstrapRole(peerAddress: Address, peerRole: LobbyRole): void {
        if (this.role !== "none") return;
        if (peerRole === "none") {
            const me = this.p2pManager.stateManager.checksumSignerAddress;
            this.setRole(
                compareAddresses(me, String(peerAddress)) < 0
                    ? "advertiser"
                    : "selector"
            );
            return;
        }
        this.setRole(peerRole === "advertiser" ? "selector" : "advertiser");
    }

    private async startMatching(
        topic: string,
        matchTimeoutMs?: number,
        observedTargetChannelId?: string
    ): Promise<LobbyMatch | undefined> {
        this.activeTopic = topic;
        this.role = "none";
        // Role epochs are per session: a peer met in an earlier session sends
        // its bootstrap availability at the epoch this map still remembers,
        // and a remembered epoch would make that message read as a repeat.
        this.peerRoleEpochs.clear();
        this.observedTargetChannelId = undefined;
        if (observedTargetChannelId) {
            this.unsubscribeTargetOpened =
                this.p2pManager.stateManager.events.on(
                    "eventHandler",
                    "onChannelOpened",
                    (openedChannelId) => {
                        if (
                            ethers.hexlify(String(openedChannelId)) !==
                                observedTargetChannelId ||
                            !this.matchResolve
                        ) {
                            return;
                        }
                        this.observedTargetChannelId = observedTargetChannelId;
                        void this.cleanup();
                    }
                );
        }
        const matchPromise = new Promise<LobbyMatch | undefined>((resolve) => {
            this.matchResolve = resolve;
        });
        if (matchTimeoutMs !== undefined) {
            this.matchTimer =
                this.p2pManager.stateManager.timeoutManager.scheduleTask(
                    () => this.cleanup(),
                    matchTimeoutMs,
                    "lobby match timeout"
                );
        }
        this.joinedTopic = topic;
        await this.p2pManager.joinDiscoveryKey(topic);
        return matchPromise;
    }

    private setRole(role: Exclude<LobbyRole, "none">): void {
        if (!this.activeTopic || !this.matchResolve) return;
        this.role = role;
        this.roleEpoch += 1;
        this.exhaustionSwitchScheduled = false;
        this.scheduleRoleSwitch();
        this.broadcastAvailability();
        if (role === "selector") void this.selectNextCandidate();
    }

    private scheduleRoleSwitch(): void {
        this.clearRoleTimer();
        const duration =
            this.roleDurationMinMs +
            Math.floor(
                Math.random() *
                    (this.roleDurationMaxMs - this.roleDurationMinMs + 1)
            );
        this.roleTimer =
            this.p2pManager.stateManager.timeoutManager.scheduleTask(
                () => this.switchRole(),
                duration,
                "lobby role duration"
            );
    }

    private switchRole(): void {
        if (this.inFlightSelection || this.reservation) {
            this.deferredRoleSwitch = true;
            return;
        }
        this.deferredRoleSwitch = false;
        this.setRole(this.role === "advertiser" ? "selector" : "advertiser");
    }

    private async selectNextCandidate(): Promise<void> {
        if (
            this.role !== "selector" ||
            this.inFlightSelection ||
            !this.activeTopic ||
            !this.matchResolve
        ) {
            return;
        }
        const next = this.candidates.entries().next().value as
            | [Address, Candidate]
            | undefined;
        if (!next) {
            if (!this.exhaustionSwitchScheduled) {
                this.exhaustionSwitchScheduled = true;
                this.scheduleRoleSwitch();
            }
            return;
        }
        const [peerAddress, candidate] = next;
        this.candidates.delete(peerAddress);
        const selection: Selection = {
            peerAddress,
            transport: candidate.transport,
            attemptNonce: this.randomBytes32(),
            roleEpoch: candidate.roleEpoch,
            selectorChallenge: this.randomBytes32(),
            unsubscribeDisconnected: candidate.unsubscribeDisconnected
        };
        this.inFlightSelection = selection;

        try {
            const pick = await this.remoteRpc.lobbyMatchingService
                .pick(
                    this.activeTopic,
                    selection.attemptNonce,
                    selection.roleEpoch,
                    selection.selectorChallenge
                )
                .request(selection.transport);
            if (this.inFlightSelection !== selection) return;
            if (pick.status !== "accepted") {
                this.settleSelection();
                void this.selectNextCandidate();
                return;
            }
            this.commitInFlight = true;
            const commit = await this.remoteRpc.lobbyMatchingService
                .commit(
                    this.activeTopic,
                    selection.attemptNonce,
                    selection.roleEpoch,
                    selection.selectorChallenge,
                    pick.advertiserChallenge
                )
                .request(selection.transport);
            this.commitInFlight = false;
            if (
                this.inFlightSelection !== selection ||
                commit.status !== "acknowledged"
            ) {
                this.settleSelection();
                void this.selectNextCandidate();
                return;
            }
            this.inFlightSelection = undefined;
            selection.unsubscribeDisconnected?.();
            await this.finishMatch({
                peerAddress,
                attemptNonce: selection.attemptNonce,
                selectorAddress:
                    this.p2pManager.stateManager.checksumSignerAddress,
                advertiserAddress: peerAddress,
                selectorChallenge: selection.selectorChallenge,
                advertiserChallenge: pick.advertiserChallenge
            });
        } catch (error) {
            this.commitInFlight = false;
            if (this.inFlightSelection !== selection) {
                this.neutralProfileLosses.delete(peerAddress);
                if (this.pendingCancellation) {
                    await this.cleanup();
                }
                return;
            }
            this.inFlightSelection = undefined;
            selection.unsubscribeDisconnected?.();
            const rejectedByGuard =
                error instanceof Error &&
                error.message === RPC_GUARD_REJECTION_ERROR;
            if (
                !rejectedByGuard &&
                !this.neutralProfileLosses.delete(peerAddress)
            ) {
                // A peer that accepted a pick and then dropped its commit
                // burned an agreement window. That is not proven misbehaviour,
                // so it spends the peer's shared retry bound.
                this.p2pManager.disconnectConnection(
                    peerAddress,
                    DisconnectPolicy.allowRetry()
                );
            } else {
                this.neutralProfileLosses.delete(peerAddress);
            }
            if (this.pendingCancellation) {
                await this.cleanup();
                return;
            }
            this.applyDeferredRoleSwitch();
            void this.selectNextCandidate();
        }
    }

    private settleSelection(): void {
        this.inFlightSelection?.unsubscribeDisconnected?.();
        this.inFlightSelection = undefined;
        this.applyDeferredRoleSwitch();
    }

    private expireReservation(peerAddress: Address): void {
        if (this.reservation?.peerAddress !== peerAddress) return;
        this.reservation.unsubscribeDisconnected?.();
        this.reservation = undefined;
        // Mirror image of the selector side: an abandoned reservation is a
        // burned agreement window, so it spends the peer's retry bound.
        this.p2pManager.disconnectConnection(
            peerAddress,
            DisconnectPolicy.allowRetry()
        );
        this.applyDeferredRoleSwitch();
        if (this.role === "advertiser") this.broadcastAvailability();
    }

    private onProfileDisconnected(peerAddress: Address): void {
        this.removeCandidate(peerAddress);
        if (this.inFlightSelection?.peerAddress === peerAddress) {
            if (this.commitInFlight) {
                // Agreement-window liability: the commit is already sent, so
                // final transport loss is not neutral. Keep the selection in
                // place so the rejected commit reaches the catch path, which
                // strikes the absent peer at once.
                this.inFlightSelection.unsubscribeDisconnected?.();
                this.inFlightSelection.unsubscribeDisconnected = undefined;
            } else {
                this.neutralProfileLosses.add(peerAddress);
                this.inFlightSelection.unsubscribeDisconnected?.();
                this.inFlightSelection = undefined;
                this.applyDeferredRoleSwitch();
                void this.selectNextCandidate();
            }
        }
        if (this.reservation?.peerAddress === peerAddress) {
            // Agreement-window liability: an accepted pick keeps its bound
            // running. expireReservation strikes the absent selector when it
            // fires; a replacement transport may still commit before then.
            this.reservation.unsubscribeDisconnected?.();
            this.reservation.unsubscribeDisconnected = undefined;
        }
    }

    private applyDeferredRoleSwitch(): void {
        if (this.deferredRoleSwitch) this.switchRole();
    }

    private sendAvailability(transport: NetworkTransport): void {
        if (!this.activeTopic || !this.matchResolve) return;
        this.remoteRpc.lobbyMatchingService
            .advertise(
                this.activeTopic,
                this.role,
                this.roleEpoch,
                this.role === "advertiser" && !this.reservation
            )
            .sendOne(transport);
    }

    private broadcastAvailability(): void {
        for (const transport of this.sessionTransports.keys()) {
            if (transport.peerAddress) this.sendAvailability(transport);
        }
    }

    private async finishMatch(match: LobbyMatch): Promise<void> {
        const resolve = this.matchResolve;
        if (!resolve) return;
        this.commitInFlight = false;
        this.resolvePendingCancellation(false);
        this.broadcastUnavailable();
        this.stopMatchingWork();
        this.matchResolve = undefined;
        await this.handoffSelectedPeer(match.peerAddress);
        resolve(match);
    }

    private async cleanup(
        options: { preserveHandedOffTransports?: boolean } = {}
    ): Promise<void> {
        const run = this.runCleanup(options);
        this.cleanupInFlight = run;
        try {
            await run;
        } finally {
            if (this.cleanupInFlight === run) this.cleanupInFlight = undefined;
        }
    }

    private async runCleanup(options: {
        preserveHandedOffTransports?: boolean;
    }): Promise<void> {
        const resolve = this.matchResolve;
        if (resolve) this.broadcastUnavailable();
        this.stopMatchingWork();
        this.activeTopic = undefined;
        this.matchResolve = undefined;
        this.unsubscribeTargetOpened?.();
        this.unsubscribeTargetOpened = undefined;
        // Leave the topic before cutting anything: a transport closed while we
        // are still joined is rediscovered and redialed right away.
        await this.leaveJoinedTopic();
        this.disconnectSessionTransports();
        if (!options.preserveHandedOffTransports) {
            this.disconnectHandedOffTransports();
        } else {
            this.handedOffTransports.clear();
            this.handedOffPeerAddress = undefined;
        }
        if (
            String(this.p2pManager.stateManager.channelId) === ZeroHash &&
            !this.p2pManager.stateManager.isDisposed &&
            this.matchesWaitingForCleanup === 0
        ) {
            this.p2pManager.stateManager.setStatus(Status.NOT_OPENED);
        }
        resolve?.(undefined);
        if (resolve) this.resolvePendingCancellation(true);
    }

    private stopMatchingWork(): void {
        this.clearRoleTimer();
        if (this.matchTimer) {
            this.p2pManager.stateManager.timeoutManager.cancelTask(
                this.matchTimer
            );
            this.matchTimer = undefined;
        }
        if (this.reservation) {
            this.reservation.unsubscribeDisconnected?.();
            this.p2pManager.stateManager.timeoutManager.cancelTask(
                this.reservation.expiry
            );
            this.reservation = undefined;
        }
        this.inFlightSelection?.unsubscribeDisconnected?.();
        this.inFlightSelection = undefined;
        for (const peerAddress of [...this.candidates.keys()]) {
            this.removeCandidate(peerAddress);
        }
        this.neutralProfileLosses.clear();
        this.commitInFlight = false;
        this.deferredRoleSwitch = false;
        this.exhaustionSwitchScheduled = false;
        this.role = "none";
    }

    private clearRoleTimer(): void {
        if (!this.roleTimer) return;
        this.p2pManager.stateManager.timeoutManager.cancelTask(this.roleTimer);
        this.roleTimer = undefined;
    }

    private removeCandidate(peerAddress: Address): void {
        const candidate = this.candidates.get(peerAddress);
        candidate?.unsubscribeDisconnected();
        this.candidates.delete(peerAddress);
    }

    private broadcastUnavailable(): void {
        if (!this.activeTopic) return;
        for (const transport of this.sessionTransports.keys()) {
            if (!transport.peerAddress) continue;
            this.remoteRpc.lobbyMatchingService
                .advertise(this.activeTopic, this.role, this.roleEpoch, false)
                .sendOne(transport);
        }
    }

    private async handoffSelectedPeer(peerAddress: Address): Promise<void> {
        this.handedOffPeerAddress = peerAddress;
        const nonSelectedTransports: NetworkTransport[] = [];
        for (const [transport, unsubscribe] of [
            ...this.sessionTransports.entries()
        ]) {
            const address = this.peerAddress(transport);
            unsubscribe();
            this.sessionTransports.delete(transport);
            if (address === peerAddress && !transport.isClosed) {
                this.handedOffTransports.add(transport);
            } else {
                nonSelectedTransports.push(transport);
            }
        }
        // Leave the lobby topic before cutting the non-selected transports.
        // Closing a transport does not stop discovery, so a loser cut while
        // the topic is still joined is re-dialled for the whole negotiation.
        await this.leaveJoinedTopic();
        for (const transport of nonSelectedTransports) {
            this.p2pManager.disconnectConnection(
                transport,
                DisconnectPolicy.ALLOW
            );
        }
    }

    /**
     * The single owner of "this session has left its lobby topic". A failed
     * leave must not hold back the handoff that awaits it, so it is reported
     * and the session continues; the worst case is the redial it prevents.
     */
    private async leaveJoinedTopic(): Promise<void> {
        const topic = this.joinedTopic;
        if (!topic) return;
        this.joinedTopic = undefined;
        try {
            await this.p2pManager.leaveDiscoveryKey(topic);
        } catch (error) {
            this.logger.warn("Failed to leave the lobby topic", {
                topic,
                error: errorMessage(error)
            });
        }
    }

    private disconnectSessionTransports(): void {
        for (const [transport, unsubscribe] of [
            ...this.sessionTransports.entries()
        ]) {
            unsubscribe();
            this.sessionTransports.delete(transport);
            this.p2pManager.disconnectConnection(
                transport,
                DisconnectPolicy.ALLOW
            );
        }
    }

    private disconnectHandedOffTransports(): void {
        for (const transport of [...this.handedOffTransports]) {
            this.handedOffTransports.delete(transport);
            this.p2pManager.disconnectConnection(
                transport,
                DisconnectPolicy.ALLOW
            );
        }
        this.handedOffPeerAddress = undefined;
    }

    private peerAddress(transport: NetworkTransport): Address | undefined {
        if (!transport.peerAddress) return undefined;
        return this.p2pManager.profileManager.getProfileByTransport(transport)
            ?.evmAddress;
    }

    private isValidRole(value: unknown): value is LobbyRole {
        return (
            value === "none" || value === "advertiser" || value === "selector"
        );
    }

    private randomBytes32(): string {
        return ethers.hexlify(ethers.randomBytes(32));
    }

    private resolvePendingCancellation(cancelled: boolean): void {
        const pending = this.pendingCancellation;
        if (!pending) return;
        this.pendingCancellation = undefined;
        pending.resolve(cancelled);
    }

    private isMatchablePeer(peerAddress: Address): boolean {
        return (
            peerAddress !==
                this.p2pManager.stateManager.checksumSignerAddress &&
            this.shouldMatchPeer(peerAddress)
        );
    }

    private validateTopic(topic: string): string {
        requireBytes32(topic, "Rendezvous topic must be exactly 32 bytes");
        return ethers.hexlify(topic);
    }
}
