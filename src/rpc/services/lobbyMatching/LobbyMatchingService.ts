import { ethers, ZeroHash } from "ethers";

import type P2PManager from "@/P2PManager";
import ARpcService from "@/rpc/ARpcService";
import type Rpc from "@/rpc/Rpc";
import { RPC_GUARD_REJECTION_ERROR } from "@/rpc/Rpc";
import type ATransport from "@/transport/ATransport";
import { Status } from "@/types";
import type { Address } from "@/types/types";
import { HandshakeCompletedGuard } from "@/rpc/guards";
import { compareAddresses } from "@/rpc/services/openChannelNegotiation/OpenChannelNegotiationHelpers";

import LobbyMatchingRpcMethods from "./LobbyMatchingRpcMethods";
import LobbyRpcAdmissionGuard from "./LobbyRpcAdmissionGuard";
import type {
    LobbyAvailability,
    LobbyCommitResult,
    LobbyMatch,
    LobbyMatchingServiceOptions,
    LobbyPickResult,
    LobbyRole,
    RoleEpoch
} from "./LobbyMatchingTypes";

type Candidate = {
    transport: ATransport;
    roleEpoch: RoleEpoch;
    unsubscribeDisconnected: () => void;
};

type Selection = {
    peerAddress: Address;
    transport: ATransport;
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

export default class LobbyMatchingService extends ARpcService<LobbyMatchingRpcMethods> {
    private readonly roleDurationMinMs: number;
    private readonly roleDurationMaxMs: number;
    private readonly shouldMatchPeer: (peerAddress: Address) => boolean;
    private readonly candidates = new Map<Address, Candidate>();
    /** Latest role epoch accepted from each authenticated peer. */
    private readonly peerRoleEpochs = new Map<Address, RoleEpoch>();
    /** Rejected lobby RPC count for each transport during this service life. */
    private readonly rejectedRpcCounts = new WeakMap<ATransport, number>();
    private readonly neutralProfileLosses = new Set<Address>();
    /** Authenticated transports owned only by the active lobby session. */
    private readonly sessionTransports = new Map<ATransport, () => void>();
    /** Selected transports promoted for negotiation and closed on retry. */
    private readonly handedOffTransports = new Set<ATransport>();
    /** Selected profile that may add replacement transports during handoff. */
    private handedOffPeerAddress?: Address;
    private activeTopic?: string;
    private role: LobbyRole = "none";
    private roleEpoch = 0;
    private inFlightSelection?: Selection;
    private reservation?: Reservation;
    private roleTimer?: ReturnType<typeof setTimeout>;
    private matchTimer?: ReturnType<typeof setTimeout>;
    private deferredRoleSwitch = false;
    private exhaustionSwitchScheduled = false;
    private matchResolve?: (match: LobbyMatch | undefined) => void;
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
            p2pManager,
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

    public createRPCMethods(transport: ATransport): LobbyMatchingRpcMethods {
        return new LobbyMatchingRpcMethods(transport, this);
    }

    public async match(
        topic: string,
        matchTimeoutMs?: number | null,
        observedTargetChannelId?: string
    ): Promise<LobbyMatch | undefined> {
        const normalizedTopic = this.validateTopic(topic);
        const normalizedTimeout = this.validateMatchTimeout(matchTimeoutMs);
        const normalizedTarget = observedTargetChannelId
            ? this.validateTopic(observedTargetChannelId)
            : undefined;

        if (this.activeTopic && !this.matchResolve) {
            throw new Error(
                "Lobby matching already handed off to channel negotiation"
            );
        }
        if (this.activeTopic) await this.cleanup(true, undefined);
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
        await this.cleanup(true, undefined);
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
        await this.cleanup(true, undefined, true);
    }

    /** Releases the selected transport after an unsigned negotiation failure. */
    public async releaseNegotiationHandoff(topic: string): Promise<void> {
        const normalizedTopic = this.validateTopic(topic);
        if (normalizedTopic !== this.activeTopic || this.matchResolve) return;
        await this.cleanup(true, undefined);
    }

    public get rendezvousTopic(): string | undefined {
        return this.activeTopic;
    }

    public ownsNegotiationPeer(transport: ATransport): boolean {
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
        role: LobbyRole;
        roleEpoch: number;
        candidateCount: number;
        matching: boolean;
        inFlight: boolean;
        reserved: boolean;
    } {
        return {
            topic: this.activeTopic,
            role: this.role,
            roleEpoch: this.roleEpoch,
            candidateCount: this.candidates.size,
            matching: !!this.matchResolve,
            inFlight: !!this.inFlightSelection,
            reserved: !!this.reservation
        };
    }

    public async dispose(): Promise<void> {
        await this.cleanup(true, undefined);
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

    public recordRejectedRpc(transport: ATransport): void {
        const count = (this.rejectedRpcCounts.get(transport) ?? 0) + 1;
        this.rejectedRpcCounts.set(transport, count);
        if (count > MAX_REJECTED_RPCS_PER_TRANSPORT) {
            this.p2pManager.disconnectAndBlacklistPeer(transport);
        }
    }

    public onAuthenticatedTransport(transport: ATransport): void {
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
            this.p2pManager.disconnectConnection(transport);
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
    public isHandedOffTransport(transport: ATransport): boolean {
        return this.handedOffTransports.has(transport);
    }

    public receiveAvailability(
        transport: ATransport,
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
            peerAddress ===
                this.p2pManager.stateManager.checksumSignerAddress ||
            !this.shouldMatchPeer(peerAddress)
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
        transport: ATransport,
        attemptNonce: string,
        roleEpoch: number,
        selectorChallenge: string
    ): LobbyPickResult {
        const peerAddress = this.peerAddress(transport);
        if (
            !peerAddress ||
            peerAddress ===
                this.p2pManager.stateManager.checksumSignerAddress ||
            !this.shouldMatchPeer(peerAddress) ||
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
        transport: ATransport,
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
            peerAddress ===
                this.p2pManager.stateManager.checksumSignerAddress ||
            !this.shouldMatchPeer(peerAddress) ||
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
        this.finishMatch({
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
                        void this.cleanup(true, undefined);
                    }
                );
        }
        const matchPromise = new Promise<LobbyMatch | undefined>((resolve) => {
            this.matchResolve = resolve;
        });
        if (matchTimeoutMs !== undefined) {
            this.matchTimer =
                this.p2pManager.stateManager.timeoutManager.scheduleTask(
                    () => this.cleanup(true, undefined),
                    matchTimeoutMs,
                    "lobby match timeout"
                );
        }
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
            this.finishMatch({
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
                    await this.cleanup(true, undefined);
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
                this.p2pManager.disconnectAndBlacklistPeerByEvmAddress(
                    peerAddress
                );
            } else {
                this.neutralProfileLosses.delete(peerAddress);
            }
            if (this.pendingCancellation) {
                await this.cleanup(true, undefined);
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
        this.p2pManager.disconnectAndBlacklistPeerByEvmAddress(peerAddress);
        this.applyDeferredRoleSwitch();
        if (this.role === "advertiser") this.broadcastAvailability();
    }

    private onProfileDisconnected(peerAddress: Address): void {
        this.removeCandidate(peerAddress);
        if (this.inFlightSelection?.peerAddress === peerAddress) {
            this.neutralProfileLosses.add(peerAddress);
            this.inFlightSelection.unsubscribeDisconnected?.();
            this.inFlightSelection = undefined;
            this.applyDeferredRoleSwitch();
            void this.selectNextCandidate();
        }
        if (this.reservation?.peerAddress === peerAddress) {
            this.reservation.unsubscribeDisconnected?.();
            this.p2pManager.stateManager.timeoutManager.cancelTask(
                this.reservation.expiry
            );
            this.reservation = undefined;
            this.applyDeferredRoleSwitch();
            if (this.role === "advertiser") this.broadcastAvailability();
        }
    }

    private applyDeferredRoleSwitch(): void {
        if (this.deferredRoleSwitch) this.switchRole();
    }

    private sendAvailability(transport: ATransport): void {
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

    private finishMatch(match: LobbyMatch): void {
        const resolve = this.matchResolve;
        if (!resolve) return;
        this.commitInFlight = false;
        this.resolvePendingCancellation(false);
        this.broadcastUnavailable();
        this.stopMatchingWork();
        this.handoffSelectedPeer(match.peerAddress);
        this.matchResolve = undefined;
        resolve(match);
    }

    private async cleanup(
        leaveTopic: boolean,
        result: LobbyMatch | undefined,
        preserveHandedOffTransports = false
    ): Promise<void> {
        const topic = this.activeTopic;
        const resolve = this.matchResolve;
        if (resolve) this.broadcastUnavailable();
        this.stopMatchingWork();
        this.activeTopic = undefined;
        this.matchResolve = undefined;
        this.unsubscribeTargetOpened?.();
        this.unsubscribeTargetOpened = undefined;
        this.disconnectSessionTransports();
        if (!preserveHandedOffTransports) {
            this.disconnectHandedOffTransports();
        } else {
            this.handedOffTransports.clear();
            this.handedOffPeerAddress = undefined;
        }
        if (leaveTopic && topic) {
            await this.p2pManager.leaveDiscoveryKey(topic);
        }
        if (
            String(this.p2pManager.stateManager.channelId) === ZeroHash &&
            !this.p2pManager.stateManager.isDisposed
        ) {
            this.p2pManager.stateManager.setStatus(Status.NOT_OPENED);
        }
        resolve?.(result);
        if (resolve) this.resolvePendingCancellation(result === undefined);
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

    private handoffSelectedPeer(peerAddress: Address): void {
        this.handedOffPeerAddress = peerAddress;
        for (const [transport, unsubscribe] of [
            ...this.sessionTransports.entries()
        ]) {
            const address = this.peerAddress(transport);
            unsubscribe();
            this.sessionTransports.delete(transport);
            if (address === peerAddress && !transport.isClosed) {
                this.handedOffTransports.add(transport);
            } else {
                this.p2pManager.disconnectConnection(transport);
            }
        }
    }

    private disconnectSessionTransports(): void {
        for (const [transport, unsubscribe] of [
            ...this.sessionTransports.entries()
        ]) {
            unsubscribe();
            this.sessionTransports.delete(transport);
            this.p2pManager.disconnectConnection(transport);
        }
    }

    private disconnectHandedOffTransports(): void {
        for (const transport of [...this.handedOffTransports]) {
            this.handedOffTransports.delete(transport);
            this.p2pManager.disconnectConnection(transport);
        }
        this.handedOffPeerAddress = undefined;
    }

    private peerAddress(transport: ATransport): Address | undefined {
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

    private validateTopic(topic: string): string {
        if (!ethers.isHexString(topic, 32)) {
            throw new Error("Rendezvous topic must be exactly 32 bytes");
        }
        return ethers.hexlify(topic);
    }

    private validateMatchTimeout(
        matchTimeoutMs?: number | null
    ): number | undefined {
        if (matchTimeoutMs === undefined || matchTimeoutMs === null) {
            return undefined;
        }
        if (!Number.isSafeInteger(matchTimeoutMs) || matchTimeoutMs <= 0) {
            throw new Error("Lobby match timeout must be a positive integer");
        }
        return matchTimeoutMs;
    }
}
