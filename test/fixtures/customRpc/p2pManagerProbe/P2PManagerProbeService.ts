// @spec-test-coverage-ignore: worker-side support service for mapped P2PManager component cases
import type P2PManager from "@/P2PManager";
import ARpcService from "@/rpc/ARpcService";
import type Rpc from "@/rpc/Rpc";
import { MAX_RPC_FRAME_BYTES } from "@/rpc/Rpc";
import ATransport from "@/transport/ATransport";
import { TransportType } from "@/transport/TransportType";
import PeerProfile from "@/PeerProfile";
import {
    Codec,
    DetachedPromises,
    SignatureUtils,
    Type,
    getChecksumAddress
} from "@/utils";
import { ethers } from "ethers";
import { Buffer } from "buffer";
import { Status } from "@/types";
import type { Bytes } from "@/types/types";
import Clock from "@/Clock";
import sinon from "sinon";
import type { PingPongRpc } from "../PingPongRpcManifest";
import { P2PManagerProbeRpcMethods } from "./P2PManagerProbeRpcMethods";
import { HolepunchTransport, WebRTCTransport } from "@/transport";
import {
    RecordingBannablePeerInfo,
    RecordingHolepunchSocket,
    RecordingSwarm,
    RecordingWebRTCDataChannel
} from "@test/fixtures/P2PTransportFixture";
import LobbyMatchingService from "@/rpc/services/lobbyMatching/LobbyMatchingService";
import {
    compareAddresses,
    deriveNegotiatedChannelId
} from "@/rpc/services/openChannelNegotiation/OpenChannelNegotiationHelpers";
import OpenChannelNegotiationService from "@/rpc/services/openChannelNegotiation/OpenChannelNegotiationService";
import type {
    MatchedNegotiationOptions,
    NegotiationOutcome
} from "@/rpc/services/openChannelNegotiation/OpenChannelNegotiationService";
import type { LobbyMatch } from "@/rpc/services/lobbyMatching/LobbyMatchingTypes";
import { createOpenChannelTestObject } from "@test/test_utils/testHelpers";

class RecordingTransport extends ATransport {
    public transportType = TransportType.HOLEPUNCH;
    public readonly frames: string[] = [];
    public closeCalls = 0;
    public sendError?: Error;
    public closeError?: Error;

    public _send(frame: string): void {
        if (this.sendError) throw this.sendError;
        this.frames.push(frame);
    }

    public onMessage(): void {}

    protected _close(): void {
        this.closeCalls += 1;
        if (this.closeError) throw this.closeError;
    }
}

export type DispatchHeadProbe = {
    oversizedDisconnected: boolean;
    oversizedBlacklisted: boolean;
    exactLimitAccepted: boolean;
    malformedDisconnected: boolean;
    malformedBlacklisted: boolean;
    unknownServiceDisconnected: boolean;
    unknownServiceBlacklisted: boolean;
    responseClassifiedBeforeDispatch: boolean;
};

export type FrameByteBoundaryProbe = {
    multibyteExactAccepted: boolean;
    multibyteOverDisconnected: boolean;
    multibyteOverBlacklisted: boolean;
    validJsonInvalidEnvelopeDisconnected: boolean;
    validJsonInvalidEnvelopeBlacklisted: boolean;
};

export type DispatchOutcomeProbe = {
    validMethodStayedConnected: boolean;
    validMethodCalls: number;
    unknownMethodDisconnected: boolean;
    unknownMethodBlacklisted: boolean;
    throwingServiceDisconnected: boolean;
    throwingServiceBlacklisted: boolean;
};

export type RequestSettlementProbe = {
    successValue: string;
    remoteError: string;
    defaultRemoteError: string;
    sendError: string;
    pendingCount: number;
    timerCount: number;
};

export type RequestRaceProbe = {
    firstOutcome: string;
    connectionPresent: boolean;
    pendingCount: number;
    timerCount: number;
};

export type TimeoutSelectionProbe = {
    defaultOutcome: string;
    explicitOutcome: string;
    pendingCount: number;
    timerCount: number;
};

export type ConcurrentSettlementProbe = {
    firstRequestId: string;
    secondRequestId: string;
    firstValue: string;
    secondValue: string;
    racedValue: string;
    pendingCount: number;
    timerCount: number;
};

export type DisposalProbe = {
    outcomes: string[];
    samePromise: boolean;
    pendingCount: number;
    timerCount: number;
};

export type DisconnectCleanupProbe = {
    closeCalls: number;
    connectionRemoved: boolean;
    profileTransportRetained: boolean;
    pendingError: string;
    pendingCount: number;
    timerCount: number;
};

export type TransportRetirementProbe = {
    oldRequestError: string;
    oldConnectionRemoved: boolean;
    replacementConnected: boolean;
    replacementValue: string;
    pendingCount: number;
    timerCount: number;
};

export type BulkPenaltyProbe = {
    blacklisted: boolean[];
    disconnected: boolean[];
};

export type ConnectedPeerFallbackProbe = {
    connectedPeers: string[];
};

export type ProfileDisconnectLifecycleProbe = {
    unauthenticatedFinalCount: number;
    authenticatedRebindCount: number;
    upgradeCountBeforeFinal: number;
    fallbackWasPromoted: boolean;
    upgradeFinalCount: number;
    repeatedCloseCount: number;
    unsubscribeCount: number;
};

export type LobbyProtocolProbe = {
    role: string;
    firstStatus: string;
    concurrentStatus: string;
    malformedCommitStatus: string;
    validCommitStatus: string;
    candidateCountAfterSameEpochUnavailable: number;
    candidateCountAfterSameEpochReadvertisement: number;
    candidateCountAfterStaleAvailability: number;
    matchPeer: string;
    matchHasChannelId: boolean;
    localChannelId: string;
    lobbyTransportsExcludedBeforeCommit: boolean;
    ordinaryHookCountBeforeCommit: number;
    selectedTransportHeldBeforeCompletion: boolean;
    selectedTransportHeldAfterExpiredTimeout: boolean;
    selectedTransportPromotedAfterCompletion: boolean;
    nonSelectedTransportClosed: boolean;
    ordinaryHookCountAfterCommitBeforeCompletion: number;
    ordinaryHookCountAfterCompletion: number;
    discardedPeerMissedOrdinaryBroadcast: boolean;
};

export type LobbyRecoveryProbe = {
    reservationAccepted: boolean;
    reservedAfterFinalLoss: boolean;
    matchingAfterFinalLoss: boolean;
    disconnectedPeerBlacklisted: boolean;
    abusiveTransportClosed: boolean;
    abusivePeerBlacklisted: boolean;
};

export type LobbyBootstrapValidationProbe = {
    bothNoneRole: string;
    bothNoneExpectedRole: string;
    oneNoneRole: string;
    malformedCandidateCount: number;
    wrongTopicCandidateCount: number;
    unauthenticatedCandidateCount: number;
    filteredCandidateCount: number;
    filteredPickStatus: string;
};

export type LobbyRoleTimerProbe = {
    defaultRoleDelayMs: number;
    configuredRoleDelayMs: number;
    roleWhileReservedAfterTimer: string;
    commitAfterTimerStatus: string;
    reservationExpiryBlacklisted: boolean;
    roleTimerScheduleCount: number;
    availabilityFramesBeforeExpiry: number;
    availabilityFramesAfterExpiry: number;
};

export type LobbySessionCleanupProbe = {
    defaultTimeoutScheduled: boolean;
    nullTimeoutScheduled: boolean;
    replacementResolvedUndefined: boolean;
    replacementTopicActive: boolean;
    replacementResolvedOnLeave: boolean;
    timeoutResolvedUndefined: boolean;
    timeoutClearedTopic: boolean;
    timeoutStatus: Status;
    disposeResolvedUndefined: boolean;
    disposeClearedTopic: boolean;
    replacementClosedOldTransport: boolean;
    leaveClosedSessionTransport: boolean;
    timeoutClosedSessionTransport: boolean;
    disposeClosedSessionTransport: boolean;
    ordinaryCancellationSucceeded: boolean;
    targetedCancellationSucceeded: boolean;
    cancellationNoopAfterHandoff: boolean;
    handedOffTransportPreservedByCancellationNoop: boolean;
    negotiationHandoffReleased: boolean;
    selectedTargetRetainedAfterRelease: boolean;
};

export type LobbyRetryEpochProbe = {
    firstRoleEpoch: number;
    secondRoleEpoch: number;
    observerCandidateCountAfterFirstSession: number;
    observerCandidateCountAfterRetry: number;
};

export type LobbyExhaustionTimerProbe = {
    scheduledAfterExhaustion: number;
    scheduledAfterRepeatedAvailability: number;
};

export type LobbyLatePickProbe = {
    responseStatus: string;
    requesterBlacklisted: boolean;
};

export type MatchedNegotiationAdmissionProbe = {
    responseBeforeInitialization: boolean;
    responseAfterInitialization: boolean;
    selectedChannelId: string;
    peerBlacklistedAfterLoss: boolean;
    channelIdAfterLoss: string;
    statusAfterLoss: Status;
};

export type InvalidNegotiationAmountProbe = {
    error: string;
    peerBlacklisted: boolean;
    channelId: string;
    status: Status;
    rendezvousTopic?: string;
    matching: boolean;
    oldLobbyTransportClosed: boolean;
};

export type NegotiationFailureProbe = {
    channelIdAfterHigherInit: string;
    initiatorTimeoutBlacklisted: boolean;
    initiatorTimeoutCleared: boolean;
    wrongPeerBlacklisted: boolean;
    wrongPeerLeftAttemptActive: boolean;
    wrongAttemptBlacklistedSelectedPeer: boolean;
    wrongAttemptCleared: boolean;
    duplicateTermsIdempotent: boolean;
    conflictingTermsBlacklisted: boolean;
    malformedProposalBlacklisted: boolean;
    malformedProposalCleared: boolean;
    alreadyOpenRejected: boolean;
    alreadyOpenBlacklisted: boolean;
    alreadyOpenKeptZeroId: boolean;
};

export type NegotiationFailureScenario =
    | "initiator-timeout"
    | "wrong-peer"
    | "wrong-attempt"
    | "terms"
    | "malformed-proposal"
    | "already-open";

export type SignedAttemptObservationProbe = {
    submissionFailureThrew: boolean;
    higherSubmittedExactPayload: boolean;
    higherSubmittedBothSignatures: boolean;
    signedAttemptRetainedAfterSubmissionFailure: boolean;
    submissionFailureDidNotReportOpen: boolean;
    higherDidNotBlacklistLowerAfterSubmissionFailure: boolean;
    higherDidNotBlacklistLowerAfterExpiry: boolean;
    lowerDidNotBlacklistHigherBeforeExpiry: boolean;
    lowerBlacklistedHigherAfterExpiry: boolean;
    signedDisposeOutcomeCancelled: boolean;
    signedAttemptClearedOnDispose: boolean;
    signedPeerBlacklistedOnFinalLoss: boolean;
    signedAttemptRetainedAfterFinalLoss: boolean;
    signedAttemptClearedAfterExpiry: boolean;
    signedAttemptIdClearedAfterExpiry: boolean;
    wrongOpenEventIgnored: boolean;
    submissionStayedPendingUntilObservation: boolean;
    matchingOpenEventClearedAttempt: boolean;
    matchingOpenEventRetainedChannelId: boolean;
};

export type TargetedNegotiationRaceProbe = {
    signatureOutcome: string;
    signatureSubmitCalls: number;
    signaturePeerBlacklisted: boolean;
    signatureAttemptCleared: boolean;
    signatureTargetRetained: boolean;
    receiptOutcome: string;
    receiptSubmitCalls: number;
    receiptPeerBlacklisted: boolean;
    receiptAttemptCleared: boolean;
    receiptTargetRetained: boolean;
    detachedErrors: number;
    unopenedReceiptOutcome: string;
    unopenedReceiptError: string;
    unopenedReceiptPeerBlacklisted: boolean;
    unopenedReceiptTargetRetained: boolean;
    ordinaryReceiptOutcome: string;
    ordinaryReceiptError: string;
    ordinaryReceiptPeerBlacklisted: boolean;
    ordinaryReceiptChannelCleared: boolean;
};

export type ForeignResponseProbe = {
    foreignBlacklisted: boolean;
    foreignDisconnected: boolean;
    intendedValue: string;
};

export type RequestRegistryProbe = {
    replacementValue: string;
    unknownResponseIgnored: boolean;
    duplicateResponseIgnored: boolean;
    pendingDisconnectErrors: string[];
    pendingCount: number;
    timerCount: number;
};

export type LifecycleProbe = {
    broadcastCounts: number[];
    duplicateAddCount: number;
    disconnectedCount: number;
    blacklistByTransport: boolean;
    blacklistByAddress: boolean;
    blacklistByStaleTransportAddress: boolean;
    staleAndCurrentDisconnected: boolean;
    missingAddressIgnored: boolean;
    connectedPeers: string[];
};

export type BanPolicyProbe = {
    banCalls: boolean[];
    socketDestroyed: boolean;
    profileBlacklisted: boolean;
};

export type UpgradeBanPolicyProbe = {
    banCallsAfterUpgrade: boolean[];
    banCallsAfterStaleClose: boolean[];
    banCallsAfterCurrentClose: boolean[];
    banCallsAfterFallback: boolean[];
};

export type UnblacklistBanPolicyScenario =
    | "selected-webrtc"
    | "selected-holepunch-with-live-webrtc"
    | "selected-holepunch-without-live-webrtc";

export type UnblacklistBanPolicyProbe = {
    selectedTransportType: TransportType | null;
    liveWebRtcCount: number;
    profileBlacklistedAfterBlacklist: boolean;
    profileBlacklistedAfterUnblacklist: boolean;
    banCalls: boolean[];
};

export type RelayAdmissionProbe = {
    admitted: boolean;
    attemptedClosed: boolean;
    attemptedSocketDestroyed: boolean;
    currentTransportType: TransportType | null;
    activePeerConnections: number;
    originalBanCalls: boolean[];
    attemptedBanCalls: boolean[];
    profileBlacklisted: boolean;
    handshakeCompleted: boolean;
    usableTrafficSent: boolean;
    disconnectionHookCalls: number;
};

export type HolepunchTopicProbe = {
    joinedTopics: string[];
    joinCalls: {
        topicHex: string;
        options: { server: boolean; client: boolean };
    }[];
    leaveCalls: string[];
};

export type HandshakeFailureProbe = {
    connected: boolean;
    hookCount: number;
    syncCallCount: number;
    failureLogged: boolean;
};

export type LateHandshakeProbe = {
    connected: boolean;
    hookCount: number;
};

export type ReplacementHandshakeProbe = {
    connectedCount: number;
    replacementConnected: boolean;
    hookCount: number;
};

export class P2PManagerProbeService extends ARpcService<
    P2PManagerProbeRpcMethods,
    P2PManager<PingPongRpc>
> {
    public dispatchCalls = 0;

    constructor(p2pManager: P2PManager<PingPongRpc>) {
        super(
            p2pManager,
            p2pManager.stateManager.logger.child({
                component: "P2PManagerProbeService"
            })
        );
    }

    public createRPCMethods(transport: ATransport): P2PManagerProbeRpcMethods {
        return new P2PManagerProbeRpcMethods(transport, this);
    }

    public recordDispatch(): void {
        this.dispatchCalls += 1;
    }

    private transport(address?: string): RecordingTransport {
        const transport = new RecordingTransport(this.p2pManager);
        transport.peerAddress = address;
        return transport;
    }

    private registeredTransport(address: string): {
        transport: RecordingTransport;
        profile: PeerProfile;
    } {
        const transport = this.transport();
        const profile = this.authenticateTransport(
            transport,
            getChecksumAddress(address)
        );
        return { transport, profile };
    }

    private requestId(transport: RecordingTransport): string {
        const frame = JSON.parse(transport.frames.at(-1) ?? "{}") as {
            requestId?: string;
        };
        if (!frame.requestId) throw new Error("Request frame has no requestId");
        return frame.requestId;
    }

    private holepunchTransport(): {
        transport: HolepunchTransport;
        peerInfo: RecordingBannablePeerInfo;
        socket: RecordingHolepunchSocket;
    } {
        const peerInfo = new RecordingBannablePeerInfo();
        const socket = new RecordingHolepunchSocket();
        const transport = new HolepunchTransport(
            socket,
            peerInfo,
            this.p2pManager
        );
        return { transport, peerInfo, socket };
    }

    private registeredHolepunchTransport(address: string): {
        transport: HolepunchTransport;
        peerInfo: RecordingBannablePeerInfo;
        socket: RecordingHolepunchSocket;
        profile: PeerProfile;
    } {
        const { transport, peerInfo, socket } = this.holepunchTransport();
        const normalizedAddress = getChecksumAddress(address);
        const profile = this.authenticateTransport(
            transport,
            normalizedAddress
        );
        return { transport, peerInfo, socket, profile };
    }

    private authenticateTransport(
        transport: ATransport,
        address: string
    ): PeerProfile {
        const profile = this.p2pManager.profileManager.authenticateTransport(
            transport,
            address
        );
        if (!profile) throw new Error("Fixture transport was not admitted");
        return profile;
    }

    private response(
        transport: RecordingTransport,
        requestId: string,
        ok: boolean,
        value?: string
    ): void {
        this.p2pManager.onRpc(
            JSON.stringify({
                rpcResponse: true,
                requestId,
                ok,
                ...(ok ? { result: value } : value ? { error: value } : {})
            }),
            transport
        );
    }

    private timerCount(): number {
        const timeoutManager = this.p2pManager.stateManager
            .timeoutManager as unknown as { timeouts: Set<unknown> };
        return timeoutManager.timeouts.size;
    }

    private resourceCounts(
        baseline: { pendingCount: number; timerCount: number } = {
            pendingCount: 0,
            timerCount: 0
        }
    ): { pendingCount: number; timerCount: number } {
        const manager = this.p2pManager as unknown as {
            pendingRpcRequests: Map<string, unknown>;
        };
        return {
            pendingCount:
                manager.pendingRpcRequests.size - baseline.pendingCount,
            timerCount: this.timerCount() - baseline.timerCount
        };
    }

    public probeDispatchHead(): DispatchHeadProbe {
        const { transport: oversized, profile: oversizedProfile } =
            this.registeredTransport(
                "0x5100000000000000000000000000000000000001"
            );
        this.p2pManager.addConnection(oversized);
        this.p2pManager.onRpc("x".repeat(MAX_RPC_FRAME_BYTES + 1), oversized);

        const exact = this.transport();
        this.p2pManager.addConnection(exact);
        const response = JSON.stringify({
            rpcResponse: true,
            requestId: "not-pending",
            ok: true
        });
        this.p2pManager.onRpc(
            response + " ".repeat(MAX_RPC_FRAME_BYTES - response.length),
            exact
        );

        const { transport: malformed, profile: malformedProfile } =
            this.registeredTransport(
                "0x5100000000000000000000000000000000000002"
            );
        this.p2pManager.addConnection(malformed);
        this.p2pManager.onRpc("{", malformed);

        const { transport: unknownService, profile: unknownServiceProfile } =
            this.registeredTransport(
                "0x5100000000000000000000000000000000000003"
            );
        this.p2pManager.addConnection(unknownService);
        this.p2pManager.onRpc(
            JSON.stringify({ service: "absent", method: "call", params: [] }),
            unknownService
        );

        const responseFirst = this.transport();
        this.p2pManager.addConnection(responseFirst);
        const callsBefore = this.dispatchCalls;
        this.p2pManager.onRpc(
            JSON.stringify({
                rpcResponse: true,
                requestId: "not-pending-either",
                ok: true,
                service: "p2pManagerProbe",
                method: "recordDispatch",
                params: []
            }),
            responseFirst
        );

        return {
            oversizedDisconnected:
                !this.p2pManager.openConnections.includes(oversized),
            oversizedBlacklisted: oversizedProfile.isBlackListed,
            exactLimitAccepted: this.p2pManager.openConnections.includes(exact),
            malformedDisconnected:
                !this.p2pManager.openConnections.includes(malformed),
            malformedBlacklisted: malformedProfile.isBlackListed,
            unknownServiceDisconnected:
                !this.p2pManager.openConnections.includes(unknownService),
            unknownServiceBlacklisted: unknownServiceProfile.isBlackListed,
            responseClassifiedBeforeDispatch:
                this.p2pManager.openConnections.includes(responseFirst) &&
                this.dispatchCalls === callsBefore
        };
    }

    private exactMultibyteFrame(): string {
        const base = JSON.stringify({
            rpcResponse: true,
            requestId: "not-pending-multibyte",
            ok: true,
            result: ""
        });
        const remainingBytes =
            MAX_RPC_FRAME_BYTES - Buffer.byteLength(base, "utf8");
        const payload =
            "é".repeat(Math.floor(remainingBytes / 2)) +
            (remainingBytes % 2 ? "a" : "");
        const frame = JSON.stringify({
            rpcResponse: true,
            requestId: "not-pending-multibyte",
            ok: true,
            result: payload
        });
        if (Buffer.byteLength(frame, "utf8") !== MAX_RPC_FRAME_BYTES) {
            throw new Error("Failed to build an exact-size multibyte frame");
        }
        return frame;
    }

    public probeFrameByteBoundaries(): FrameByteBoundaryProbe {
        const exact = this.transport();
        this.p2pManager.addConnection(exact);
        const exactFrame = this.exactMultibyteFrame();
        this.p2pManager.onRpc(exactFrame, exact);

        const { transport: over, profile: overProfile } =
            this.registeredTransport(
                "0x5200000000000000000000000000000000000001"
            );
        this.p2pManager.addConnection(over);
        this.p2pManager.onRpc(`${exactFrame}x`, over);

        const { transport: invalidEnvelope, profile: invalidEnvelopeProfile } =
            this.registeredTransport(
                "0x5200000000000000000000000000000000000002"
            );
        this.p2pManager.addConnection(invalidEnvelope);
        this.p2pManager.onRpc(
            JSON.stringify({ service: "p2pManagerProbe" }),
            invalidEnvelope
        );

        return {
            multibyteExactAccepted:
                this.p2pManager.openConnections.includes(exact),
            multibyteOverDisconnected:
                !this.p2pManager.openConnections.includes(over),
            multibyteOverBlacklisted: overProfile.isBlackListed,
            validJsonInvalidEnvelopeDisconnected:
                !this.p2pManager.openConnections.includes(invalidEnvelope),
            validJsonInvalidEnvelopeBlacklisted:
                invalidEnvelopeProfile.isBlackListed
        };
    }

    public probeDispatchOutcomes(): DispatchOutcomeProbe {
        const valid = this.transport();
        this.p2pManager.addConnection(valid);
        const callsBefore = this.dispatchCalls;
        this.p2pManager.onRpc(
            JSON.stringify({
                service: "p2pManagerProbe",
                method: "recordDispatch",
                params: []
            }),
            valid
        );

        const { transport: unknownMethod, profile: unknownMethodProfile } =
            this.registeredTransport(
                "0x5300000000000000000000000000000000000001"
            );
        this.p2pManager.addConnection(unknownMethod);
        this.p2pManager.onRpc(
            JSON.stringify({
                service: "p2pManagerProbe",
                method: "absent",
                params: []
            }),
            unknownMethod
        );

        const { transport: throwing, profile: throwingProfile } =
            this.registeredTransport(
                "0x5300000000000000000000000000000000000002"
            );
        this.p2pManager.addConnection(throwing);
        const root = this.p2pManager.localRpc as PingPongRpc & {
            throwingProbe?: {
                p2pManager: object;
                createRPCMethods(): object;
                runRPC(): boolean;
            };
        };
        root.throwingProbe = {
            p2pManager: this.p2pManager,
            createRPCMethods: () => ({}),
            runRPC: () => {
                throw new Error("dispatch failed");
            }
        };
        try {
            this.p2pManager.onRpc(
                JSON.stringify({
                    service: "throwingProbe",
                    method: "call",
                    params: []
                }),
                throwing
            );
        } finally {
            delete root.throwingProbe;
        }

        return {
            validMethodStayedConnected:
                this.p2pManager.openConnections.includes(valid),
            validMethodCalls: this.dispatchCalls - callsBefore,
            unknownMethodDisconnected:
                !this.p2pManager.openConnections.includes(unknownMethod),
            unknownMethodBlacklisted: unknownMethodProfile.isBlackListed,
            throwingServiceDisconnected:
                !this.p2pManager.openConnections.includes(throwing),
            throwingServiceBlacklisted: throwingProfile.isBlackListed
        };
    }

    private beginRequest(
        transport: RecordingTransport,
        timeoutMs = 100
    ): { requestId: string; promise: Promise<string> } {
        const promise = this.p2pManager.sendRpcRequest<string>(
            { service: "pingService", method: "sum", params: [] },
            transport,
            { timeoutMs }
        );
        return { requestId: this.requestId(transport), promise };
    }

    public async probeRequestSettlement(): Promise<RequestSettlementProbe> {
        const resourceBaseline = this.resourceCounts();
        const success = this.transport(
            "0x1000000000000000000000000000000000000001"
        );
        const first = this.beginRequest(success);
        this.response(success, first.requestId, true, "accepted");

        const remoteFailure = this.transport(
            "0x2000000000000000000000000000000000000002"
        );
        const second = this.beginRequest(remoteFailure);
        this.response(remoteFailure, second.requestId, false, "remote failed");

        const defaultFailure = this.transport(
            "0x3000000000000000000000000000000000000003"
        );
        const third = this.beginRequest(defaultFailure);
        this.response(defaultFailure, third.requestId, false);

        const sendFailure = this.transport();
        sendFailure.sendError = new Error("send failed");
        const fourth = this.p2pManager.sendRpcRequest<string>(
            { service: "pingService", method: "sum", params: [] },
            sendFailure,
            { timeoutMs: 20 }
        );

        const error = async (promise: Promise<string>): Promise<string> => {
            try {
                await promise;
                return "resolved";
            } catch (reason) {
                return reason instanceof Error
                    ? reason.message
                    : String(reason);
            }
        };

        const result = {
            successValue: await first.promise,
            remoteError: await error(second.promise),
            defaultRemoteError: await error(third.promise),
            sendError: await error(fourth)
        };
        return { ...result, ...this.resourceCounts(resourceBaseline) };
    }

    public async probeTimeoutSelection(): Promise<TimeoutSelectionProbe> {
        const resourceBaseline = this.resourceCounts();
        const originalAgreementTime =
            this.p2pManager.stateManager.timeConfig.agreementTime;
        this.p2pManager.stateManager.timeConfig.agreementTime = 0.02;
        try {
            const defaultTransport = this.transport();
            const defaultPromise = this.p2pManager.sendRpcRequest<string>(
                { service: "pingService", method: "never", params: [] },
                defaultTransport
            );
            const explicitTransport = this.transport();
            const explicitPromise = this.p2pManager.sendRpcRequest<string>(
                { service: "pingService", method: "never", params: [] },
                explicitTransport,
                { timeoutMs: 7 }
            );
            const outcomes = await Promise.all([
                defaultPromise.catch((error: Error) => error.message),
                explicitPromise.catch((error: Error) => error.message)
            ]);
            return {
                defaultOutcome: outcomes[0],
                explicitOutcome: outcomes[1],
                ...this.resourceCounts(resourceBaseline)
            };
        } finally {
            this.p2pManager.stateManager.timeConfig.agreementTime =
                originalAgreementTime;
        }
    }

    public async probeResponseTimeoutRace(
        responseFirst: boolean
    ): Promise<RequestRaceProbe> {
        const resourceBaseline = this.resourceCounts();
        const transport = this.transport(
            "0x4000000000000000000000000000000000000004"
        );
        this.p2pManager.addConnection(transport);
        const request = this.beginRequest(transport, 20);
        if (responseFirst)
            this.response(transport, request.requestId, true, "response");
        const firstOutcome = await request.promise.catch(
            (error: Error) => error.message
        );
        if (!responseFirst)
            this.response(transport, request.requestId, true, "late");
        await new Promise((resolve) => setTimeout(resolve, 30));
        return {
            firstOutcome,
            connectionPresent:
                this.p2pManager.openConnections.includes(transport),
            ...this.resourceCounts(resourceBaseline)
        };
    }

    public async probeRemoteErrorTimeoutRace(
        errorFirst: boolean
    ): Promise<RequestRaceProbe> {
        const resourceBaseline = this.resourceCounts();
        const transport = this.transport(
            "0x4100000000000000000000000000000000000004"
        );
        this.p2pManager.addConnection(transport);
        const request = this.beginRequest(transport, 20);
        if (errorFirst)
            this.response(transport, request.requestId, false, "remote error");
        const firstOutcome = await request.promise.catch(
            (error: Error) => error.message
        );
        if (!errorFirst)
            this.response(transport, request.requestId, false, "late error");
        await new Promise((resolve) => setTimeout(resolve, 30));
        return {
            firstOutcome,
            connectionPresent:
                this.p2pManager.openConnections.includes(transport),
            ...this.resourceCounts(resourceBaseline)
        };
    }

    public async probeResponseRemoteErrorRace(
        responseFirst: boolean
    ): Promise<RequestRaceProbe> {
        const resourceBaseline = this.resourceCounts();
        const transport = this.transport(
            "0x4200000000000000000000000000000000000004"
        );
        this.p2pManager.addConnection(transport);
        const request = this.beginRequest(transport);
        if (responseFirst) {
            this.response(transport, request.requestId, true, "response");
            this.response(transport, request.requestId, false, "late error");
        } else {
            this.response(transport, request.requestId, false, "remote error");
            this.response(transport, request.requestId, true, "late response");
        }
        return {
            firstOutcome: await request.promise.catch(
                (error: Error) => error.message
            ),
            connectionPresent:
                this.p2pManager.openConnections.includes(transport),
            ...this.resourceCounts(resourceBaseline)
        };
    }

    public async probeResponseDisconnectRace(
        responseFirst: boolean
    ): Promise<RequestRaceProbe> {
        const resourceBaseline = this.resourceCounts();
        const transport = this.transport(
            "0x5000000000000000000000000000000000000005"
        );
        this.p2pManager.addConnection(transport);
        const request = this.beginRequest(transport);
        if (responseFirst) {
            this.response(transport, request.requestId, true, "response");
            this.p2pManager.disconnectConnection(transport);
        } else {
            this.p2pManager.disconnectConnection(transport);
            this.response(transport, request.requestId, true, "late");
        }
        return {
            firstOutcome: await request.promise.catch(
                (error: Error) => error.message
            ),
            connectionPresent:
                this.p2pManager.openConnections.includes(transport),
            ...this.resourceCounts(resourceBaseline)
        };
    }

    public async probeRemoteErrorDisconnectRace(
        errorFirst: boolean
    ): Promise<RequestRaceProbe> {
        const resourceBaseline = this.resourceCounts();
        const transport = this.transport(
            "0x5100000000000000000000000000000000000005"
        );
        this.p2pManager.addConnection(transport);
        const request = this.beginRequest(transport);
        if (errorFirst) {
            this.response(transport, request.requestId, false, "remote error");
            this.p2pManager.disconnectConnection(transport);
        } else {
            this.p2pManager.disconnectConnection(transport);
            this.response(transport, request.requestId, false, "late error");
        }
        return {
            firstOutcome: await request.promise.catch(
                (error: Error) => error.message
            ),
            connectionPresent:
                this.p2pManager.openConnections.includes(transport),
            ...this.resourceCounts(resourceBaseline)
        };
    }

    public async probeTimeoutDisconnectRace(
        timeoutFirst: boolean
    ): Promise<RequestRaceProbe> {
        const resourceBaseline = this.resourceCounts();
        const transport = this.transport(
            "0x6000000000000000000000000000000000000006"
        );
        this.p2pManager.addConnection(transport);
        const request = this.beginRequest(transport, timeoutFirst ? 15 : 100);
        if (timeoutFirst) {
            await new Promise((resolve) => setTimeout(resolve, 25));
            this.p2pManager.disconnectConnection(transport);
        } else {
            this.p2pManager.disconnectConnection(transport);
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
        return {
            firstOutcome: await request.promise.catch(
                (error: Error) => error.message
            ),
            connectionPresent:
                this.p2pManager.openConnections.includes(transport),
            ...this.resourceCounts(resourceBaseline)
        };
    }

    public async probeConcurrentSettlement(): Promise<ConcurrentSettlementProbe> {
        const resourceBaseline = this.resourceCounts();
        const transport = this.transport(
            "0x7000000000000000000000000000000000000007"
        );
        const first = this.beginRequest(transport);
        const second = this.beginRequest(transport);
        this.response(transport, second.requestId, true, "second");
        this.response(transport, first.requestId, true, "first");

        const raced = this.beginRequest(transport);
        await Promise.all([
            Promise.resolve().then(() =>
                this.response(transport, raced.requestId, true, "winner")
            ),
            Promise.resolve().then(() =>
                this.response(transport, raced.requestId, true, "loser")
            )
        ]);

        return {
            firstRequestId: first.requestId,
            secondRequestId: second.requestId,
            firstValue: await first.promise,
            secondValue: await second.promise,
            racedValue: await raced.promise,
            ...this.resourceCounts(resourceBaseline)
        };
    }

    public async probeDisposal(): Promise<DisposalProbe> {
        const resourceBaseline = this.resourceCounts();
        const firstTransport = this.transport(
            "0x8000000000000000000000000000000000000008"
        );
        const secondTransport = this.transport(
            "0x9000000000000000000000000000000000000009"
        );
        this.p2pManager.addConnection(firstTransport);
        this.p2pManager.addConnection(secondTransport);
        const first = this.beginRequest(firstTransport, 1000);
        const second = this.beginRequest(secondTransport, 1000);
        const outcomesPromise = Promise.all([
            first.promise.catch((error: Error) => error.message),
            second.promise.catch((error: Error) => error.message)
        ]);
        const firstDisposal = this.p2pManager.dispose();
        const secondDisposal = this.p2pManager.dispose();
        await firstDisposal;
        return {
            outcomes: await outcomesPromise,
            samePromise: firstDisposal === secondDisposal,
            ...this.resourceCounts(resourceBaseline)
        };
    }

    public async probeDisconnectCleanup(
        addressInput: string
    ): Promise<DisconnectCleanupProbe> {
        const resourceBaseline = this.resourceCounts();
        const address = getChecksumAddress(addressInput);
        const transport = this.transport(address);
        transport.closeError = new Error("close failed");
        const profile = new PeerProfile(transport, address);
        this.p2pManager.profileManager.registerProfile(profile);
        this.p2pManager.addConnection(transport);
        const request = this.beginRequest(transport, 1000);

        this.p2pManager.disconnectConnection(transport);

        return {
            closeCalls: transport.closeCalls,
            connectionRemoved:
                !this.p2pManager.openConnections.includes(transport),
            profileTransportRetained:
                this.p2pManager.profileManager.getProfileByTransport(
                    transport
                ) === profile,
            pendingError: await request.promise.catch(
                (error: Error) => error.message
            ),
            ...this.resourceCounts(resourceBaseline)
        };
    }

    public async probeTransportRetirement(
        addressInput: string
    ): Promise<TransportRetirementProbe> {
        const resourceBaseline = this.resourceCounts();
        const address = getChecksumAddress(addressInput);
        const oldTransport = this.transport(address);
        const replacement = this.transport(address);
        const profile = new PeerProfile(oldTransport, address);
        this.p2pManager.profileManager.registerProfile(profile);
        this.p2pManager.addConnection(oldTransport);
        const oldRequest = this.beginRequest(oldTransport, 1000);
        const oldRequestError = oldRequest.promise.catch(
            (error: Error) => error.message
        );
        const originalAgreementTime =
            this.p2pManager.stateManager.timeConfig.agreementTime;
        this.p2pManager.stateManager.timeConfig.agreementTime = 0.005;
        try {
            this.p2pManager.profileManager.updateTransport(
                address,
                replacement
            );
            this.p2pManager.addConnection(replacement);
            await new Promise((resolve) => setTimeout(resolve, 15));

            const replacementRequest = this.beginRequest(replacement, 1000);
            this.response(
                replacement,
                replacementRequest.requestId,
                true,
                "replacement-live"
            );
            return {
                oldRequestError: await oldRequestError,
                oldConnectionRemoved:
                    !this.p2pManager.openConnections.includes(oldTransport),
                replacementConnected:
                    this.p2pManager.openConnections.includes(replacement),
                replacementValue: await replacementRequest.promise,
                ...this.resourceCounts(resourceBaseline)
            };
        } finally {
            this.p2pManager.stateManager.timeConfig.agreementTime =
                originalAgreementTime;
        }
    }

    public probeBulkPenalty(
        firstAddressInput: string,
        secondAddressInput: string
    ): BulkPenaltyProbe {
        const firstAddress = getChecksumAddress(firstAddressInput);
        const secondAddress = getChecksumAddress(secondAddressInput);
        const first = this.transport(firstAddress);
        const second = this.transport(secondAddress);
        const firstProfile = new PeerProfile(first, firstAddress);
        const secondProfile = new PeerProfile(second, secondAddress);
        this.p2pManager.profileManager.registerProfile(firstProfile);
        this.p2pManager.profileManager.registerProfile(secondProfile);
        this.p2pManager.addConnection(first);
        this.p2pManager.addConnection(second);

        this.p2pManager.disconnectAndBlacklistPeers([
            firstAddress,
            secondAddress
        ]);

        return {
            blacklisted: [
                firstProfile.isBlackListed,
                secondProfile.isBlackListed
            ],
            disconnected: [first, second].map(
                (transport) =>
                    !this.p2pManager.openConnections.includes(transport)
            )
        };
    }

    public probeConnectedPeerFallback(
        addressInput: string
    ): ConnectedPeerFallbackProbe {
        const address = getChecksumAddress(addressInput);
        const fromProfile = this.transport();
        const duplicate = this.transport(address.toLowerCase());
        const unknown = this.transport();
        const profile = new PeerProfile(fromProfile, address);
        this.p2pManager.profileManager.registerProfile(profile);
        fromProfile.peerAddress = undefined;
        this.p2pManager.addConnection(fromProfile);
        this.p2pManager.addConnection(duplicate);
        this.p2pManager.addConnection(unknown);

        return {
            connectedPeers: [...this.p2pManager.getConnectedPeers()].map(String)
        };
    }

    public async probeForeignResponse(
        intendedAddressInput: string,
        foreignAddressInput: string
    ): Promise<ForeignResponseProbe> {
        const intendedAddress = getChecksumAddress(intendedAddressInput);
        const foreignAddress = getChecksumAddress(foreignAddressInput);
        const intended = this.transport(intendedAddress);
        const foreign = this.transport(foreignAddress);
        const foreignProfile = new PeerProfile(foreign, foreignAddress);
        this.p2pManager.profileManager.registerProfile(foreignProfile);
        this.p2pManager.addConnection(intended);
        this.p2pManager.addConnection(foreign);
        const request = this.beginRequest(intended);
        this.response(foreign, request.requestId, true, "forged");
        this.response(intended, request.requestId, true, "intended");
        return {
            foreignBlacklisted: foreignProfile.isBlackListed,
            foreignDisconnected:
                !this.p2pManager.openConnections.includes(foreign),
            intendedValue: await request.promise
        };
    }

    public async probeRequestRegistry(
        addressInput: string
    ): Promise<RequestRegistryProbe> {
        const resourceBaseline = this.resourceCounts();
        const address = getChecksumAddress(addressInput);
        const original = this.transport(address);
        const replacement = this.transport(address);
        const replacementProfile = new PeerProfile(original, address);
        this.p2pManager.profileManager.registerProfile(replacementProfile);
        this.p2pManager.addConnection(original);
        const replacementRequest = this.beginRequest(original);
        const originalAgreementTime =
            this.p2pManager.stateManager.timeConfig.agreementTime;
        this.p2pManager.stateManager.timeConfig.agreementTime = 0.005;
        this.p2pManager.profileManager.updateTransport(address, replacement);
        this.p2pManager.addConnection(replacement);
        this.response(
            replacement,
            replacementRequest.requestId,
            true,
            "replacement"
        );
        await new Promise((resolve) => setTimeout(resolve, 15));
        this.p2pManager.stateManager.timeConfig.agreementTime =
            originalAgreementTime;

        const unknown = this.transport();
        this.p2pManager.addConnection(unknown);
        this.response(unknown, "absent", true, "ignored");

        const duplicate = this.transport(address);
        this.p2pManager.addConnection(duplicate);
        const duplicateRequest = this.beginRequest(duplicate);
        this.response(duplicate, duplicateRequest.requestId, true, "once");
        await duplicateRequest.promise;
        this.response(duplicate, duplicateRequest.requestId, true, "twice");

        const pending = this.transport(
            "0xB000000000000000000000000000000000000001"
        );
        this.p2pManager.addConnection(pending);
        const first = this.beginRequest(pending);
        const second = this.beginRequest(pending);
        this.p2pManager.disconnectConnection(pending);
        const errors = await Promise.all([
            first.promise.catch((error: Error) => error.message),
            second.promise.catch((error: Error) => error.message)
        ]);

        return {
            replacementValue: await replacementRequest.promise,
            unknownResponseIgnored:
                this.p2pManager.openConnections.includes(unknown),
            duplicateResponseIgnored:
                this.p2pManager.openConnections.includes(duplicate),
            pendingDisconnectErrors: errors,
            ...this.resourceCounts(resourceBaseline)
        };
    }

    public async probeLifecycle(
        firstAddressInput: string,
        secondAddressInput: string,
        missingAddressInput: string
    ): Promise<LifecycleProbe> {
        const firstAddress = getChecksumAddress(firstAddressInput);
        const secondAddress = getChecksumAddress(secondAddressInput);
        const missingAddress = getChecksumAddress(missingAddressInput);
        const first = this.transport(firstAddress.toLowerCase());
        const second = this.transport(secondAddress);
        const unknown = this.transport();
        this.p2pManager.addConnection(first);
        this.p2pManager.addConnection(first);
        this.p2pManager.addConnection(second);
        this.p2pManager.addConnection(unknown);
        const duplicateAddCount = this.p2pManager.openConnections.filter(
            (transport) => transport === first
        ).length;
        this.p2pManager.broadcastRpc({
            service: "pingService",
            method: "recordPing",
            params: ["broadcast"]
        });
        const broadcastCounts = [
            first.frames.length,
            second.frames.length,
            unknown.frames.length
        ];
        const connectedPeers = [...this.p2pManager.getConnectedPeers()].map(
            String
        );

        const firstProfile = new PeerProfile(first, firstAddress);
        const secondProfile = new PeerProfile(second, secondAddress);
        this.p2pManager.profileManager.registerProfile(firstProfile);
        this.p2pManager.profileManager.registerProfile(secondProfile);

        const staleAddress = getChecksumAddress(
            "0x5400000000000000000000000000000000000001"
        );
        const current = this.transport(staleAddress);
        const stale = this.transport(staleAddress);
        const staleAddressProfile = new PeerProfile(current, staleAddress);
        this.p2pManager.profileManager.registerProfile(staleAddressProfile);
        this.p2pManager.addConnection(current);
        this.p2pManager.addConnection(stale);

        this.p2pManager.disconnectAndBlacklistPeer(first);
        this.p2pManager.disconnectAndBlacklistPeerByEvmAddress(secondAddress);
        this.p2pManager.disconnectAndBlacklistPeer(stale);
        this.p2pManager.disconnectAndBlacklistPeerByEvmAddress(missingAddress);

        return {
            broadcastCounts,
            duplicateAddCount,
            disconnectedCount: [first, second].filter(
                (transport) =>
                    !this.p2pManager.openConnections.includes(transport)
            ).length,
            blacklistByTransport: firstProfile.isBlackListed,
            blacklistByAddress: secondProfile.isBlackListed,
            blacklistByStaleTransportAddress: staleAddressProfile.isBlackListed,
            staleAndCurrentDisconnected:
                !this.p2pManager.openConnections.includes(stale) &&
                !this.p2pManager.openConnections.includes(current),
            missingAddressIgnored:
                !this.p2pManager.isBlacklisted(missingAddress),
            connectedPeers
        };
    }

    public probeUnauthenticatedBlacklist(): BanPolicyProbe {
        const { transport, peerInfo, socket } = this.holepunchTransport();
        const profile =
            this.p2pManager.profileManager.getProfileByTransport(transport);

        this.p2pManager.disconnectAndBlacklistPeer(transport);

        return {
            banCalls: [...peerInfo.banCalls],
            socketDestroyed: socket.destroyed,
            profileBlacklisted: profile?.isBlackListed ?? false
        };
    }

    public probeUnauthenticatedClose(): BanPolicyProbe {
        const { transport, peerInfo, socket } = this.holepunchTransport();
        const profile =
            this.p2pManager.profileManager.getProfileByTransport(transport);

        transport.close();
        this.p2pManager.disconnectAndBlacklistPeer(transport);

        return {
            banCalls: [...peerInfo.banCalls],
            socketDestroyed: socket.destroyed,
            profileBlacklisted: profile?.isBlackListed ?? false
        };
    }

    public probeUpgradeBanPolicy(address: string): UpgradeBanPolicyProbe {
        const { peerInfo } = this.registeredHolepunchTransport(address);
        const firstWebRTC = new WebRTCTransport(
            new RecordingWebRTCDataChannel(),
            this.p2pManager
        );
        this.authenticateTransport(firstWebRTC, address);
        const banCallsAfterUpgrade = [...peerInfo.banCalls];

        const secondWebRTC = new WebRTCTransport(
            new RecordingWebRTCDataChannel(),
            this.p2pManager
        );
        this.authenticateTransport(secondWebRTC, address);
        this.p2pManager.profileManager.releaseHolepunchBanOnWebRtcClose(
            firstWebRTC
        );
        const banCallsAfterStaleClose = [...peerInfo.banCalls];

        this.p2pManager.profileManager.releaseHolepunchBanOnWebRtcClose(
            secondWebRTC
        );
        const banCallsAfterCurrentClose = [...peerInfo.banCalls];
        const fallback = this.holepunchTransport().transport;
        this.p2pManager.profileManager.updateTransport(address, fallback);
        return {
            banCallsAfterUpgrade,
            banCallsAfterStaleClose,
            banCallsAfterCurrentClose,
            banCallsAfterFallback: [...peerInfo.banCalls]
        };
    }

    public probeExplicitBlacklist(address: string): BanPolicyProbe {
        const { peerInfo, socket, profile } =
            this.registeredHolepunchTransport(address);
        const webRTC = new WebRTCTransport(
            new RecordingWebRTCDataChannel(),
            this.p2pManager
        );
        this.authenticateTransport(webRTC, address);
        peerInfo.banCalls.length = 0;

        this.p2pManager.disconnectAndBlacklistPeerByEvmAddress(address);

        return {
            banCalls: [...peerInfo.banCalls],
            socketDestroyed: socket.destroyed,
            profileBlacklisted: profile.isBlackListed
        };
    }

    public probeUnblacklistBanPolicy(
        address: string,
        scenario: UnblacklistBanPolicyScenario
    ): UnblacklistBanPolicyProbe {
        const { peerInfo, profile } =
            this.registeredHolepunchTransport(address);
        const webRTC = new WebRTCTransport(
            new RecordingWebRTCDataChannel(),
            this.p2pManager
        );
        this.authenticateTransport(webRTC, address);

        if (scenario !== "selected-webrtc") {
            const fallback = this.holepunchTransport().transport;
            profile.attachTransport(fallback);
            if (scenario === "selected-holepunch-without-live-webrtc") {
                profile.detachTransport(webRTC);
                webRTC.close(true);
            }
        }

        peerInfo.banCalls.length = 0;
        this.p2pManager.profileManager.blacklistPeer(address);
        const profileBlacklistedAfterBlacklist = profile.isBlackListed;
        this.p2pManager.profileManager.unblacklistPeer(address);

        return {
            selectedTransportType:
                profile.getTransport()?.transportType ?? null,
            liveWebRtcCount: profile
                .getLiveTransports()
                .filter(
                    (transport) =>
                        transport.transportType === TransportType.WEBRTC
                ).length,
            profileBlacklistedAfterBlacklist,
            profileBlacklistedAfterUnblacklist: profile.isBlackListed,
            banCalls: [...peerInfo.banCalls]
        };
    }

    public async probeHealthyWebRtcRejectsHolepunch(
        address: string
    ): Promise<RelayAdmissionProbe> {
        const { peerInfo: originalPeerInfo, profile } =
            this.registeredHolepunchTransport(address);
        const webRTC = new WebRTCTransport(
            new RecordingWebRTCDataChannel(),
            this.p2pManager
        );
        this.authenticateTransport(webRTC, address);
        this.p2pManager.addConnection(webRTC);

        const {
            transport: attempted,
            peerInfo: attemptedPeerInfo,
            socket: attemptedSocket
        } = this.holepunchTransport();
        const disconnectionHookCalls =
            await this.finalizeAndCountDisconnections(attempted, address);
        const admitted = this.isAuthenticatedCurrentTransport(attempted);

        return this.relayAdmissionResult({
            address,
            admitted,
            attempted,
            attemptedPeerInfo,
            attemptedSocket,
            originalPeerInfo,
            profile,
            disconnectionHookCalls
        });
    }

    public async probeWebRtcCloseAcceptsHolepunch(
        address: string
    ): Promise<RelayAdmissionProbe> {
        const { peerInfo: originalPeerInfo, profile } =
            this.registeredHolepunchTransport(address);
        const webRTC = new WebRTCTransport(
            new RecordingWebRTCDataChannel(),
            this.p2pManager
        );
        this.authenticateTransport(webRTC, address);
        this.p2pManager.addConnection(webRTC);
        webRTC.close();

        const {
            transport: attempted,
            peerInfo: attemptedPeerInfo,
            socket: attemptedSocket
        } = this.holepunchTransport();
        const disconnectionHookCalls =
            await this.finalizeAndCountDisconnections(attempted, address);
        const admitted = this.isAuthenticatedCurrentTransport(attempted);
        if (admitted) {
            attempted.send({
                service: "probe",
                method: "ordinaryTraffic",
                params: ["usable"]
            });
        }

        return this.relayAdmissionResult({
            address,
            admitted,
            attempted,
            attemptedPeerInfo,
            attemptedSocket,
            originalPeerInfo,
            profile,
            disconnectionHookCalls
        });
    }

    public async probeBlacklistRejectsHolepunch(
        address: string
    ): Promise<RelayAdmissionProbe> {
        const { peerInfo: originalPeerInfo, profile } =
            this.registeredHolepunchTransport(address);
        const webRTC = new WebRTCTransport(
            new RecordingWebRTCDataChannel(),
            this.p2pManager
        );
        this.authenticateTransport(webRTC, address);
        this.p2pManager.addConnection(webRTC);
        this.p2pManager.disconnectAndBlacklistPeerByEvmAddress(address);

        const {
            transport: attempted,
            peerInfo: attemptedPeerInfo,
            socket: attemptedSocket
        } = this.holepunchTransport();
        const disconnectionHookCalls =
            await this.finalizeAndCountDisconnections(attempted, address);
        const admitted = this.isAuthenticatedCurrentTransport(attempted);

        return this.relayAdmissionResult({
            address,
            admitted,
            attempted,
            attemptedPeerInfo,
            attemptedSocket,
            originalPeerInfo,
            profile,
            disconnectionHookCalls
        });
    }

    private relayAdmissionResult({
        address,
        admitted,
        attempted,
        attemptedPeerInfo,
        attemptedSocket,
        originalPeerInfo,
        profile,
        disconnectionHookCalls
    }: {
        address: string;
        admitted: boolean;
        attempted: HolepunchTransport;
        attemptedPeerInfo: RecordingBannablePeerInfo;
        attemptedSocket: RecordingHolepunchSocket;
        originalPeerInfo: RecordingBannablePeerInfo;
        profile: PeerProfile;
        disconnectionHookCalls: number;
    }): RelayAdmissionProbe {
        const current =
            this.p2pManager.profileManager.getTransportByEvmAddress(address);
        const usableTrafficSent = attemptedSocket.writes.some((frame) => {
            const rpc = JSON.parse(frame) as Partial<Rpc>;
            return (
                rpc.service === "probe" &&
                rpc.method === "ordinaryTraffic" &&
                rpc.params?.[0] === "usable"
            );
        });
        return {
            admitted,
            attemptedClosed: attempted.isClosed,
            attemptedSocketDestroyed: attemptedSocket.destroyed,
            currentTransportType: current?.transportType ?? null,
            activePeerConnections: this.p2pManager.openConnections.filter(
                (transport) =>
                    !transport.isClosed &&
                    transport.peerAddress === getChecksumAddress(address)
            ).length,
            originalBanCalls: [...originalPeerInfo.banCalls],
            attemptedBanCalls: [...attemptedPeerInfo.banCalls],
            profileBlacklisted: profile.isBlackListed,
            handshakeCompleted: this.isAuthenticatedCurrentTransport(attempted),
            usableTrafficSent,
            disconnectionHookCalls
        };
    }

    private async finalizeAndCountDisconnections(
        transport: ATransport,
        address: string
    ): Promise<number> {
        let disconnectionHookCalls = 0;
        const unsubscribe = this.p2pManager.stateManager.events.on(
            "p2pEventHooks",
            "onDisconnection",
            () => {
                disconnectionHookCalls += 1;
            }
        );
        try {
            await this.finalizeTransportIdentity(transport, address);
            return disconnectionHookCalls;
        } finally {
            unsubscribe();
        }
    }

    private async finalizeTransportIdentity(
        transport: ATransport,
        address: string
    ): Promise<void> {
        const initHandshake = this.p2pManager.localRpc.initHandshakeService;
        initHandshake.markHandshakeInFlight(transport);
        initHandshake.recordVerifiedPeerAddress(transport, address);
        initHandshake.markAcked(transport);
        initHandshake.setRemotePreferredTransport(
            transport,
            TransportType.HOLEPUNCH
        );
        await initHandshake.maybeFinalizeHandshakeOnceFromTransport(transport);
    }

    private isAuthenticatedCurrentTransport(transport: ATransport): boolean {
        const profile =
            this.p2pManager.profileManager.getProfileByTransport(transport);
        return (
            profile?.getTransport() === transport &&
            transport.peerAddress !== undefined
        );
    }

    public async probeHolepunchJoinAndEqualLeave(): Promise<HolepunchTopicProbe> {
        const swarm = new RecordingSwarm();
        const previousSwarm = this.p2pManager.holepunch.swarm;
        this.p2pManager.holepunch.swarm = swarm;
        try {
            await this.p2pManager.holepunch.join(Buffer.from("topic-a"));
            await this.p2pManager.holepunch.leave(Buffer.from("topic-a"));
            return this.holepunchTopicProbe(swarm);
        } finally {
            this.p2pManager.holepunch.swarm = previousSwarm;
            this.p2pManager.holepunch.topics = [];
        }
    }

    public async probeHolepunchDuplicateLeave(): Promise<HolepunchTopicProbe> {
        const swarm = new RecordingSwarm();
        const previousSwarm = this.p2pManager.holepunch.swarm;
        this.p2pManager.holepunch.swarm = swarm;
        try {
            await this.p2pManager.holepunch.join(Buffer.from("topic-a"));
            await this.p2pManager.holepunch.join(Buffer.from("topic-a"));
            await this.p2pManager.holepunch.leave(Buffer.from("topic-a"));
            return this.holepunchTopicProbe(swarm);
        } finally {
            this.p2pManager.holepunch.swarm = previousSwarm;
            this.p2pManager.holepunch.topics = [];
        }
    }

    public async probeHolepunchAbsentLeave(): Promise<HolepunchTopicProbe> {
        const swarm = new RecordingSwarm();
        const previousSwarm = this.p2pManager.holepunch.swarm;
        this.p2pManager.holepunch.swarm = swarm;
        try {
            await this.p2pManager.holepunch.join(Buffer.from("topic-a"));
            await this.p2pManager.holepunch.leave(Buffer.from("topic-b"));
            return this.holepunchTopicProbe(swarm);
        } finally {
            this.p2pManager.holepunch.swarm = previousSwarm;
            this.p2pManager.holepunch.topics = [];
        }
    }

    public async probeHolepunchLeaveBeforeSwarm(): Promise<HolepunchTopicProbe> {
        const previousSwarm = this.p2pManager.holepunch.swarm;
        this.p2pManager.holepunch.swarm = undefined;
        try {
            await this.p2pManager.holepunch.leave(Buffer.from("topic-a"));
            return {
                joinedTopics: this.p2pManager.holepunch.topics.map((topic) =>
                    topic.toString("hex")
                ),
                joinCalls: [],
                leaveCalls: []
            };
        } finally {
            this.p2pManager.holepunch.swarm = previousSwarm;
            this.p2pManager.holepunch.topics = [];
        }
    }

    public async probeHolepunchRejoinAfterLeave(): Promise<HolepunchTopicProbe> {
        const initialSwarm = new RecordingSwarm();
        const replacementSwarm = new RecordingSwarm();
        const previousSwarm = this.p2pManager.holepunch.swarm;
        const previousInjectedSwarm = Object.getOwnPropertyDescriptor(
            globalThis,
            "Hyperswarm"
        );
        this.p2pManager.holepunch.swarm = initialSwarm;
        try {
            await this.p2pManager.holepunch.join(Buffer.from("topic-a"));
            await this.p2pManager.holepunch.join(Buffer.from("topic-b"));
            await this.p2pManager.holepunch.leave(Buffer.from("topic-a"));
            Object.defineProperty(globalThis, "Hyperswarm", {
                configurable: true,
                value: replacementSwarm
            });
            this.p2pManager.holepunch.swarm = undefined;
            await this.p2pManager.holepunch.join(Buffer.from("topic-c"));
            return this.holepunchTopicProbe(replacementSwarm);
        } finally {
            if (previousInjectedSwarm) {
                Object.defineProperty(
                    globalThis,
                    "Hyperswarm",
                    previousInjectedSwarm
                );
            } else {
                Reflect.deleteProperty(globalThis, "Hyperswarm");
            }
            this.p2pManager.holepunch.swarm = previousSwarm;
            this.p2pManager.holepunch.topics = [];
        }
    }

    private holepunchTopicProbe(swarm: RecordingSwarm): HolepunchTopicProbe {
        return {
            joinedTopics: this.p2pManager.holepunch.topics.map((topic) =>
                topic.toString("hex")
            ),
            joinCalls: [...swarm.joinCalls],
            leaveCalls: [...swarm.leaveCalls]
        };
    }

    public async probeHandshakeParticipantReadFailure(
        address: string
    ): Promise<HandshakeFailureProbe> {
        const stateManager = this.p2pManager.stateManager;
        const originalChannelId = stateManager.channelId;
        const transport = this.transport(getChecksumAddress(address));
        const profile = new PeerProfile(transport, getChecksumAddress(address));
        this.p2pManager.profileManager.registerProfile(profile);
        stateManager.setStatus(Status.OPENED);
        await stateManager.setChannelId("0x12");
        const originalDebug = this.p2pManager.logger.debug.bind(
            this.p2pManager.logger
        );
        let hookCount = 0;
        let syncCallCount = 0;
        let failureLogged = false;
        let resolveConnection!: () => void;
        const connection = new Promise<void>((resolve) => {
            resolveConnection = resolve;
        });

        const sync = sinon
            .stub(this.p2pManager.localRpc.spectateService, "sync")
            .callsFake(() => {
                syncCallCount += 1;
                return Promise.resolve(true);
            });
        const debug = sinon
            .stub(this.p2pManager.logger, "debug")
            .callsFake((message, ...metadata) => {
                if (String(message).includes("participant read failed"))
                    failureLogged = true;
                originalDebug(message, ...metadata);
            });
        const unsubscribeConnection = stateManager.events.on(
            "p2pEventHooks",
            "onConnection",
            () => {
                hookCount += 1;
                resolveConnection();
            }
        );

        try {
            stateManager.p2pEventHooks.handshakeCompleted?.(
                getChecksumAddress(address)
            );
            await connection;
            return {
                connected: this.p2pManager.openConnections.includes(transport),
                hookCount,
                syncCallCount,
                failureLogged
            };
        } finally {
            await stateManager.setChannelId(originalChannelId);
            sync.restore();
            debug.restore();
            unsubscribeConnection();
        }
    }

    public async probeMissingHandshake(
        address: string
    ): Promise<LateHandshakeProbe> {
        const stateManager = this.p2pManager.stateManager;
        let hookCount = 0;
        const connectionCount = this.p2pManager.openConnections.length;
        const unsubscribeConnection = stateManager.events.on(
            "p2pEventHooks",
            "onConnection",
            () => {
                hookCount += 1;
            }
        );

        try {
            stateManager.p2pEventHooks.handshakeCompleted?.(
                getChecksumAddress(address)
            );
            await Promise.resolve();
            return {
                connected:
                    this.p2pManager.openConnections.length > connectionCount,
                hookCount
            };
        } finally {
            unsubscribeConnection();
        }
    }

    public async probeClosedHandshake(
        address: string
    ): Promise<LateHandshakeProbe> {
        const stateManager = this.p2pManager.stateManager;
        const transport = this.transport(getChecksumAddress(address));
        const profile = new PeerProfile(transport, getChecksumAddress(address));
        this.p2pManager.profileManager.registerProfile(profile);
        let hookCount = 0;
        const unsubscribeConnection = stateManager.events.on(
            "p2pEventHooks",
            "onConnection",
            () => {
                hookCount += 1;
            }
        );

        try {
            transport.close();
            stateManager.p2pEventHooks.handshakeCompleted?.(
                getChecksumAddress(address)
            );
            await Promise.resolve();
            return {
                connected: this.p2pManager.openConnections.includes(transport),
                hookCount
            };
        } finally {
            unsubscribeConnection();
        }
    }

    public async probeDisposedHandshake(
        address: string
    ): Promise<LateHandshakeProbe> {
        const stateManager = this.p2pManager.stateManager;
        const transport = this.transport(getChecksumAddress(address));
        const profile = new PeerProfile(transport, getChecksumAddress(address));
        this.p2pManager.profileManager.registerProfile(profile);
        let hookCount = 0;
        const unsubscribeConnection = stateManager.events.on(
            "p2pEventHooks",
            "onConnection",
            () => {
                hookCount += 1;
            }
        );

        try {
            await this.p2pManager.dispose();
            stateManager.p2pEventHooks.handshakeCompleted?.(
                getChecksumAddress(address)
            );
            await Promise.resolve();
            return {
                connected: this.p2pManager.openConnections.includes(transport),
                hookCount
            };
        } finally {
            unsubscribeConnection();
        }
    }

    public async probeReplacementHandshake(
        address: string
    ): Promise<ReplacementHandshakeProbe> {
        const stateManager = this.p2pManager.stateManager;
        stateManager.setStatus(Status.SYNCED);
        const normalizedAddress = getChecksumAddress(address);
        const first = this.transport(normalizedAddress);
        const profile = new PeerProfile(first, normalizedAddress);
        this.p2pManager.profileManager.registerProfile(profile);
        let hookCount = 0;
        let resolveConnection!: () => void;
        let connection = new Promise<void>((resolve) => {
            resolveConnection = resolve;
        });
        const unsubscribeConnection = stateManager.events.on(
            "p2pEventHooks",
            "onConnection",
            () => {
                hookCount += 1;
                resolveConnection();
            }
        );

        try {
            stateManager.p2pEventHooks.handshakeCompleted?.(normalizedAddress);
            await connection;
            const replacement = this.transport(normalizedAddress);
            this.p2pManager.profileManager.updateTransport(
                normalizedAddress,
                replacement
            );
            connection = new Promise<void>((resolve) => {
                resolveConnection = resolve;
            });
            stateManager.p2pEventHooks.handshakeCompleted?.(normalizedAddress);
            await connection;
            this.p2pManager.profileManager.removeTransport(first, true);

            return {
                connectedCount: this.p2pManager.openConnections.filter(
                    (transport) => transport.peerAddress === normalizedAddress
                ).length,
                replacementConnected:
                    this.p2pManager.openConnections.includes(replacement),
                hookCount
            };
        } finally {
            unsubscribeConnection();
        }
    }

    public probeProfileDisconnectLifecycle(
        address: string
    ): ProfileDisconnectLifecycleProbe {
        const unauthenticated = this.transport();
        const unauthenticatedProfile =
            this.p2pManager.profileManager.getProfileByTransport(
                unauthenticated
            )!;
        let unauthenticatedFinalCount = 0;
        unauthenticatedProfile.onDisconnected(() => {
            unauthenticatedFinalCount += 1;
        });
        this.p2pManager.profileManager.removeTransport(unauthenticated);

        const normalizedAddress = getChecksumAddress(address);
        const rebinding = this.transport();
        const temporaryProfile =
            this.p2pManager.profileManager.getProfileByTransport(rebinding)!;
        let authenticatedRebindCount = 0;
        temporaryProfile.onDisconnected(() => {
            authenticatedRebindCount += 1;
        });
        this.p2pManager.profileManager.authenticateTransport(
            rebinding,
            normalizedAddress
        );
        this.p2pManager.profileManager.removeTransport(rebinding);

        const fallback = this.transport(normalizedAddress);
        const profile = new PeerProfile(fallback, normalizedAddress);
        this.p2pManager.profileManager.registerProfile(profile);
        const replacement = this.transport(normalizedAddress);
        this.p2pManager.profileManager.updateTransport(
            normalizedAddress,
            replacement
        );
        let upgradeFinalCount = 0;
        const unsubscribe = profile.onDisconnected(() => {
            upgradeFinalCount += 1;
        });
        let unsubscribeCount = 0;
        const removeUnsubscribed = profile.onDisconnected(() => {
            unsubscribeCount += 1;
        });
        removeUnsubscribed();

        this.p2pManager.profileManager.removeTransport(replacement);
        const upgradeCountBeforeFinal = upgradeFinalCount;
        const fallbackWasPromoted = profile.getTransport() === fallback;
        this.p2pManager.profileManager.removeTransport(fallback);
        this.p2pManager.profileManager.removeTransport(fallback);
        const repeatedCloseCount = upgradeFinalCount;
        unsubscribe();

        return {
            unauthenticatedFinalCount,
            authenticatedRebindCount,
            upgradeCountBeforeFinal,
            fallbackWasPromoted,
            upgradeFinalCount,
            repeatedCloseCount,
            unsubscribeCount
        };
    }

    public async probeLobbyProtocol(): Promise<LobbyProtocolProbe> {
        const service = this.p2pManager.localRpc.lobbyMatchingService;
        const topic = `0x${"ab".repeat(32)}`;
        const firstAddress = getChecksumAddress(
            "0xffffffffffffffffffffffffffffffffffffffff"
        );
        const secondAddress = getChecksumAddress(
            "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
        );
        const first = this.transport(firstAddress);
        const second = this.transport(secondAddress);
        this.p2pManager.profileManager.registerProfile(
            new PeerProfile(first, firstAddress)
        );
        this.p2pManager.profileManager.registerProfile(
            new PeerProfile(second, secondAddress)
        );
        let ordinaryHookCount = 0;
        const unsubscribeConnection = this.p2pManager.stateManager.events.on(
            "p2pEventHooks",
            "onConnection",
            () => {
                ordinaryHookCount += 1;
            }
        );
        const matchPromise = service.match(topic, 200);
        await Promise.resolve();
        service.onAuthenticatedTransport(first);
        service.onAuthenticatedTransport(second);
        const lobbyTransportsExcludedBeforeCommit =
            !this.p2pManager.openConnections.includes(first) &&
            !this.p2pManager.openConnections.includes(second);
        const ordinaryHookCountBeforeCommit = ordinaryHookCount;
        service.receiveAvailability(first, {
            topic,
            role: "none",
            roleEpoch: 0,
            available: false
        });
        const role = service.getAvailability().role;
        service.receiveAvailability(second, {
            topic,
            role: "advertiser",
            roleEpoch: 2,
            available: true
        });
        service.receiveAvailability(second, {
            topic,
            role: "advertiser",
            roleEpoch: 2,
            available: false
        });
        const candidateCountAfterSameEpochUnavailable =
            service.getAvailability().candidateCount;
        service.receiveAvailability(second, {
            topic,
            role: "advertiser",
            roleEpoch: 2,
            available: true
        });
        const candidateCountAfterSameEpochReadvertisement =
            service.getAvailability().candidateCount;
        service.receiveAvailability(second, {
            topic,
            role: "advertiser",
            roleEpoch: 1,
            available: false
        });
        const candidateCountAfterStaleAvailability =
            service.getAvailability().candidateCount;
        const attemptNonce = `0x${"01".repeat(32)}`;
        const selectorChallenge = `0x${"02".repeat(32)}`;
        const firstPick = service.receivePick(
            first,
            attemptNonce,
            1,
            selectorChallenge
        );
        const concurrentPick = service.receivePick(
            second,
            `0x${"03".repeat(32)}`,
            1,
            `0x${"04".repeat(32)}`
        );
        if (firstPick.status !== "accepted") {
            throw new Error("Expected the first lobby pick to be accepted");
        }
        const malformedCommit = service.receiveCommit(
            first,
            attemptNonce,
            1,
            selectorChallenge,
            `0x${"05".repeat(32)}`
        );
        const validCommit = service.receiveCommit(
            first,
            attemptNonce,
            1,
            selectorChallenge,
            firstPick.advertiserChallenge
        );
        const match = await matchPromise;
        if (!match) throw new Error("Expected a committed lobby match");
        const matchHasChannelId = Object.prototype.hasOwnProperty.call(
            match,
            "channelId"
        );
        const selectedTransportHeldBeforeCompletion =
            !this.p2pManager.openConnections.includes(first) &&
            service.isHandedOffTransport(first);
        await new Promise((resolve) => setTimeout(resolve, 225));
        const selectedTransportHeldAfterExpiredTimeout =
            !first.isClosed && service.isHandedOffTransport(first);
        const nonSelectedTransportClosed = second.isClosed;
        const ordinaryHookCountAfterCommitBeforeCompletion = ordinaryHookCount;
        const discardedFramesBeforeBroadcast = second.frames.length;
        this.p2pManager.broadcastRpc({
            service: "pingService",
            method: "recordPing",
            params: ["post-lobby"]
        });
        const discardedPeerMissedOrdinaryBroadcast =
            second.frames.length === discardedFramesBeforeBroadcast;
        await service.completeLobby(topic);
        const selectedTransportPromotedAfterCompletion =
            this.p2pManager.openConnections.includes(first);
        const ordinaryHookCountAfterCompletion = ordinaryHookCount;
        unsubscribeConnection();
        return {
            role,
            firstStatus: firstPick.status,
            concurrentStatus: concurrentPick.status,
            malformedCommitStatus: malformedCommit.status,
            validCommitStatus: validCommit.status,
            candidateCountAfterSameEpochUnavailable,
            candidateCountAfterSameEpochReadvertisement,
            candidateCountAfterStaleAvailability,
            matchPeer: String(match.peerAddress),
            matchHasChannelId,
            localChannelId: String(this.p2pManager.stateManager.channelId),
            lobbyTransportsExcludedBeforeCommit,
            ordinaryHookCountBeforeCommit,
            selectedTransportHeldBeforeCompletion,
            selectedTransportHeldAfterExpiredTimeout,
            selectedTransportPromotedAfterCompletion,
            nonSelectedTransportClosed,
            ordinaryHookCountAfterCommitBeforeCompletion,
            ordinaryHookCountAfterCompletion,
            discardedPeerMissedOrdinaryBroadcast
        };
    }

    public async probeLobbyRecovery(): Promise<LobbyRecoveryProbe> {
        const service = this.p2pManager.localRpc.lobbyMatchingService;
        const topic = `0x${"31".repeat(32)}`;
        const peerAddress = getChecksumAddress(
            "0xffffffffffffffffffffffffffffffffffffffff"
        );
        const transport = this.transport(peerAddress);
        const profile = new PeerProfile(transport, peerAddress);
        this.p2pManager.profileManager.registerProfile(profile);
        void service.match(topic);
        await Promise.resolve();
        service.receiveAvailability(transport, {
            topic,
            role: "none",
            roleEpoch: 0,
            available: false
        });
        const pick = service.receivePick(
            transport,
            `0x${"32".repeat(32)}`,
            1,
            `0x${"33".repeat(32)}`
        );
        this.p2pManager.profileManager.removeTransport(transport);
        await Promise.resolve();

        const abusiveAddress = getChecksumAddress(
            "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
        );
        const abusive = this.transport(abusiveAddress);
        const abusiveProfile = new PeerProfile(abusive, abusiveAddress);
        this.p2pManager.profileManager.registerProfile(abusiveProfile);
        const wrongTopicRpc: Rpc = {
            service: "lobbyMatchingService",
            method: "advertise",
            params: [`0x${"34".repeat(32)}`, "advertiser", 1, true]
        };
        for (let rejected = 0; rejected < 9; rejected += 1) {
            service.runRPC(wrongTopicRpc, abusive);
        }

        const availability = service.getAvailability();
        return {
            reservationAccepted: pick.status === "accepted",
            reservedAfterFinalLoss: availability.reserved,
            matchingAfterFinalLoss: availability.matching,
            disconnectedPeerBlacklisted: profile.isBlackListed,
            abusiveTransportClosed: abusive.isClosed,
            abusivePeerBlacklisted: abusiveProfile.isBlackListed
        };
    }

    public async probeLobbyBootstrapAndValidation(): Promise<LobbyBootstrapValidationProbe> {
        const localAddress = getChecksumAddress(
            String(this.p2pManager.stateManager.signerAddress)
        );
        const peerAddress = getChecksumAddress(
            "0xffffffffffffffffffffffffffffffffffffffff"
        );
        const service = this.p2pManager.localRpc.lobbyMatchingService;
        const firstTopic = `0x${"41".repeat(32)}`;
        const first = this.transport(peerAddress);
        this.p2pManager.profileManager.registerProfile(
            new PeerProfile(first, peerAddress)
        );
        void service.match(firstTopic);
        await Promise.resolve();
        service.receiveAvailability(first, {
            topic: firstTopic,
            role: "none",
            roleEpoch: 0,
            available: false
        });
        const bothNoneRole = service.getAvailability().role;
        const bothNoneExpectedRole =
            compareAddresses(localAddress, peerAddress) < 0
                ? "advertiser"
                : "selector";
        await service.cancelMatching(firstTopic);

        const secondTopic = `0x${"42".repeat(32)}`;
        const second = this.transport(peerAddress);
        this.p2pManager.profileManager.registerProfile(
            new PeerProfile(second, peerAddress)
        );
        void service.match(secondTopic);
        await Promise.resolve();
        service.receiveAvailability(second, {
            topic: secondTopic,
            role: "advertiser",
            roleEpoch: 1,
            available: false
        });
        const oneNoneRole = service.getAvailability().role;
        service.receiveAvailability(second, {
            topic: secondTopic,
            role: "invalid" as "advertiser",
            roleEpoch: Number.NaN,
            available: true
        });
        const malformedCandidateCount =
            service.getAvailability().candidateCount;
        service.receiveAvailability(second, {
            topic: `0x${"43".repeat(32)}`,
            role: "advertiser",
            roleEpoch: 2,
            available: true
        });
        const wrongTopicCandidateCount =
            service.getAvailability().candidateCount;
        const unauthenticated = this.transport();
        service.receiveAvailability(unauthenticated, {
            topic: secondTopic,
            role: "advertiser",
            roleEpoch: 2,
            available: true
        });
        const unauthenticatedCandidateCount =
            service.getAvailability().candidateCount;
        await service.cancelMatching(secondTopic);

        const filteredTopic = `0x${"44".repeat(32)}`;
        const filtered = new LobbyMatchingService(this.p2pManager, {
            shouldMatchPeer: () => false
        });
        const filteredTransport = this.transport(peerAddress);
        this.p2pManager.profileManager.registerProfile(
            new PeerProfile(filteredTransport, peerAddress)
        );
        void filtered.match(filteredTopic);
        await Promise.resolve();
        filtered.receiveAvailability(filteredTransport, {
            topic: filteredTopic,
            role: "advertiser",
            roleEpoch: 1,
            available: true
        });
        const filteredCandidateCount =
            filtered.getAvailability().candidateCount;
        const filteredPickStatus = filtered.receivePick(
            filteredTransport,
            `0x${"45".repeat(32)}`,
            0,
            `0x${"46".repeat(32)}`
        ).status;
        await filtered.cancelMatching(filteredTopic);

        return {
            bothNoneRole,
            bothNoneExpectedRole,
            oneNoneRole,
            malformedCandidateCount,
            wrongTopicCandidateCount,
            unauthenticatedCandidateCount,
            filteredCandidateCount,
            filteredPickStatus
        };
    }

    public async probeLobbyRoleTimers(): Promise<LobbyRoleTimerProbe> {
        const timeoutManager = this.p2pManager.stateManager.timeoutManager;
        const originalScheduleTask =
            timeoutManager.scheduleTask.bind(timeoutManager);
        const scheduled: {
            delayMs: number;
            taskName?: string;
            task: () => void | Promise<void>;
        }[] = [];
        timeoutManager.scheduleTask = ((task, delayMs, taskName) => {
            scheduled.push({ delayMs, taskName, task });
            return originalScheduleTask(task, delayMs, taskName);
        }) as typeof timeoutManager.scheduleTask;
        try {
            const peerAddress = getChecksumAddress(
                "0xffffffffffffffffffffffffffffffffffffffff"
            );
            const defaultTopic = `0x${"51".repeat(32)}`;
            const defaultService = new LobbyMatchingService(this.p2pManager);
            const defaultPeer = this.transport(peerAddress);
            this.p2pManager.profileManager.registerProfile(
                new PeerProfile(defaultPeer, peerAddress)
            );
            void defaultService.match(defaultTopic);
            await Promise.resolve();
            defaultService.onAuthenticatedTransport(defaultPeer);
            defaultService.receiveAvailability(defaultPeer, {
                topic: defaultTopic,
                role: "none",
                roleEpoch: 0,
                available: false
            });
            const defaultRoleDelayMs = scheduled.find(
                (entry) => entry.taskName === "lobby role duration"
            )!.delayMs;
            await defaultService.cancelMatching(defaultTopic);

            scheduled.length = 0;
            const configuredTopic = `0x${"52".repeat(32)}`;
            const configuredService = new LobbyMatchingService(
                this.p2pManager,
                {
                    roleDurationMinMs: 37,
                    roleDurationMaxMs: 37
                }
            );
            const selector = this.transport(peerAddress);
            this.p2pManager.profileManager.registerProfile(
                new PeerProfile(selector, peerAddress)
            );
            void configuredService.match(configuredTopic);
            await Promise.resolve();
            configuredService.onAuthenticatedTransport(selector);
            configuredService.receiveAvailability(selector, {
                topic: configuredTopic,
                role: "none",
                roleEpoch: 0,
                available: false
            });
            const configuredRoleEntry = scheduled.find(
                (entry) => entry.taskName === "lobby role duration"
            )!;
            const configuredRoleDelayMs = configuredRoleEntry.delayMs;
            const pick = configuredService.receivePick(
                selector,
                `0x${"53".repeat(32)}`,
                1,
                `0x${"54".repeat(32)}`
            );
            await configuredRoleEntry.task();
            const roleWhileReservedAfterTimer =
                configuredService.getAvailability().role;
            if (pick.status !== "accepted") {
                throw new Error("Expected held advertiser reservation");
            }
            const commitAfterTimerStatus = configuredService.receiveCommit(
                selector,
                `0x${"53".repeat(32)}`,
                1,
                `0x${"54".repeat(32)}`,
                pick.advertiserChallenge
            ).status;
            await configuredService.completeLobby(configuredTopic);

            scheduled.length = 0;
            const expiryTopic = `0x${"55".repeat(32)}`;
            const expiryService = new LobbyMatchingService(this.p2pManager, {
                roleDurationMinMs: 5000,
                roleDurationMaxMs: 5000
            });
            const silentAddress = getChecksumAddress(
                "0xfffffffffffffffffffffffffffffffffffffffd"
            );
            const silent = this.transport(silentAddress);
            const silentProfile = new PeerProfile(silent, silentAddress);
            this.p2pManager.profileManager.registerProfile(silentProfile);
            const expiryObserverAddress = getChecksumAddress(
                "0xcccccccccccccccccccccccccccccccccccccccc"
            );
            const expiryObserver = this.transport(expiryObserverAddress);
            this.p2pManager.profileManager.registerProfile(
                new PeerProfile(expiryObserver, expiryObserverAddress)
            );
            void expiryService.match(expiryTopic);
            await Promise.resolve();
            expiryService.onAuthenticatedTransport(silent);
            expiryService.onAuthenticatedTransport(expiryObserver);
            expiryService.receiveAvailability(silent, {
                topic: expiryTopic,
                role: "none",
                roleEpoch: 0,
                available: false
            });
            const expiryPick = expiryService.receivePick(
                silent,
                `0x${"56".repeat(32)}`,
                1,
                `0x${"57".repeat(32)}`
            );
            if (expiryPick.status !== "accepted") {
                throw new Error("Expected expiring advertiser reservation");
            }
            const roleTimerScheduleCount = scheduled.filter(
                (entry) => entry.taskName === "lobby role duration"
            ).length;
            const availabilityFramesBeforeExpiry = expiryObserver.frames.length;
            const expiry = scheduled.find(
                (entry) =>
                    entry.taskName === "lobby advertiser reservation expiry"
            )!;
            await expiry.task();
            const availabilityFramesAfterExpiry = expiryObserver.frames.length;
            const reservationExpiryBlacklisted = silentProfile.isBlackListed;
            await expiryService.cancelMatching(expiryTopic);
            return {
                defaultRoleDelayMs,
                configuredRoleDelayMs,
                roleWhileReservedAfterTimer,
                commitAfterTimerStatus,
                reservationExpiryBlacklisted,
                roleTimerScheduleCount,
                availabilityFramesBeforeExpiry,
                availabilityFramesAfterExpiry
            };
        } finally {
            timeoutManager.scheduleTask = originalScheduleTask;
        }
    }

    public async probeLobbySessionCleanup(): Promise<LobbySessionCleanupProbe> {
        const timeoutManager = this.p2pManager.stateManager.timeoutManager;
        const originalScheduleTask =
            timeoutManager.scheduleTask.bind(timeoutManager);
        const scheduledTaskNames: string[] = [];
        timeoutManager.scheduleTask = ((task, delayMs, taskName) => {
            if (taskName) scheduledTaskNames.push(taskName);
            return originalScheduleTask(task, delayMs, taskName);
        }) as typeof timeoutManager.scheduleTask;
        const service = new LobbyMatchingService(this.p2pManager);
        const firstTopic = `0x${"61".repeat(32)}`;
        const secondTopic = `0x${"62".repeat(32)}`;
        const first = service.match(firstTopic);
        await Promise.resolve();
        const firstTransport = this.transport(
            "0xffffffffffffffffffffffffffffffffffffffff"
        );
        this.p2pManager.profileManager.registerProfile(
            new PeerProfile(
                firstTransport,
                getChecksumAddress(firstTransport.peerAddress!)
            )
        );
        service.onAuthenticatedTransport(firstTransport);
        const defaultTimeoutScheduled = scheduledTaskNames.includes(
            "lobby match timeout"
        );
        const second = service.match(secondTopic);
        const replacementResolvedUndefined = (await first) === undefined;
        const replacementClosedOldTransport = firstTransport.isClosed;
        const secondTransport = this.transport(
            "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
        );
        this.p2pManager.profileManager.registerProfile(
            new PeerProfile(
                secondTransport,
                getChecksumAddress(secondTransport.peerAddress!)
            )
        );
        service.onAuthenticatedTransport(secondTransport);
        const replacementTopicActive =
            service.getAvailability().topic === secondTopic &&
            service.getAvailability().matching;
        await service.cancelMatching(`0x${"63".repeat(32)}`);
        await service.cancelMatching(secondTopic);
        const replacementResolvedOnLeave = (await second) === undefined;
        const leaveClosedSessionTransport = secondTransport.isClosed;
        await service.cancelMatching(secondTopic);

        scheduledTaskNames.length = 0;
        const nullTimeoutService = new LobbyMatchingService(this.p2pManager);
        const nullTimeoutTopic = `0x${"66".repeat(32)}`;
        const nullTimeoutPromise = nullTimeoutService.match(
            nullTimeoutTopic,
            null
        );
        await Promise.resolve();
        const nullTimeoutScheduled = scheduledTaskNames.includes(
            "lobby match timeout"
        );
        await nullTimeoutService.cancelMatching(nullTimeoutTopic);
        await nullTimeoutPromise;

        const timeoutService = new LobbyMatchingService(this.p2pManager);
        const timeoutPromise = timeoutService.match(`0x${"64".repeat(32)}`, 20);
        await Promise.resolve();
        const timeoutTransport = this.transport(
            "0xdddddddddddddddddddddddddddddddddddddddd"
        );
        this.p2pManager.profileManager.registerProfile(
            new PeerProfile(
                timeoutTransport,
                getChecksumAddress(timeoutTransport.peerAddress!)
            )
        );
        timeoutService.onAuthenticatedTransport(timeoutTransport);
        const timeoutResult = await timeoutPromise;
        const timeoutResolvedUndefined = timeoutResult === undefined;
        const timeoutClearedTopic =
            timeoutService.getAvailability().topic === undefined;
        const timeoutStatus = this.p2pManager.stateManager.status;
        const timeoutClosedSessionTransport = timeoutTransport.isClosed;

        const disposeService = new LobbyMatchingService(this.p2pManager);
        const disposePromise = disposeService.match(`0x${"65".repeat(32)}`);
        await Promise.resolve();
        const disposeTransport = this.transport(
            "0xcccccccccccccccccccccccccccccccccccccccc"
        );
        this.p2pManager.profileManager.registerProfile(
            new PeerProfile(
                disposeTransport,
                getChecksumAddress(disposeTransport.peerAddress!)
            )
        );
        disposeService.onAuthenticatedTransport(disposeTransport);
        await disposeService.dispose();
        const disposeResolvedUndefined = (await disposePromise) === undefined;
        const disposeClearedTopic =
            disposeService.getAvailability().topic === undefined;
        const disposeClosedSessionTransport = disposeTransport.isClosed;

        const cancellationService = new LobbyMatchingService(this.p2pManager);
        const ordinaryTopic = `0x${"67".repeat(32)}`;
        const ordinaryMatch = cancellationService.match(ordinaryTopic);
        await Promise.resolve();
        const ordinaryCancellationSucceeded =
            await cancellationService.cancelMatching(ordinaryTopic);
        await ordinaryMatch;
        const targetedTopic = `0x${"68".repeat(32)}`;
        const targetedMatch = cancellationService.match(targetedTopic);
        await Promise.resolve();
        const targetedCancellationSucceeded =
            await cancellationService.cancelMatching(targetedTopic);
        await targetedMatch;

        const handoffTopic = `0x${"69".repeat(32)}`;
        const selectedTarget = `0x${"6c".repeat(32)}`;
        await this.p2pManager.stateManager.setChannelId(selectedTarget);
        const handoffMatch = cancellationService.match(handoffTopic);
        await Promise.resolve();
        const handoffAddress = getChecksumAddress(
            "0xffffffffffffffffffffffffffffffffffffffff"
        );
        const handoffTransport = this.transport(handoffAddress);
        this.p2pManager.profileManager.registerProfile(
            new PeerProfile(handoffTransport, handoffAddress)
        );
        cancellationService.onAuthenticatedTransport(handoffTransport);
        cancellationService.receiveAvailability(handoffTransport, {
            topic: handoffTopic,
            role: "none",
            roleEpoch: 0,
            available: false
        });
        const handoffNonce = `0x${"6a".repeat(32)}`;
        const handoffChallenge = `0x${"6b".repeat(32)}`;
        const handoffPick = cancellationService.receivePick(
            handoffTransport,
            handoffNonce,
            1,
            handoffChallenge
        );
        if (handoffPick.status !== "accepted") {
            throw new Error("Expected cancellation handoff reservation");
        }
        cancellationService.receiveCommit(
            handoffTransport,
            handoffNonce,
            1,
            handoffChallenge,
            handoffPick.advertiserChallenge
        );
        await handoffMatch;
        const cancellationNoopAfterHandoff =
            !(await cancellationService.cancelMatching(handoffTopic));
        const handedOffTransportPreservedByCancellationNoop =
            cancellationService.isHandedOffTransport(handoffTransport) &&
            !handoffTransport.isClosed;
        await cancellationService.releaseNegotiationHandoff(handoffTopic);
        const negotiationHandoffReleased =
            cancellationService.getAvailability().matching === false &&
            cancellationService.getAvailability().topic === undefined;
        const selectedTargetRetainedAfterRelease =
            String(this.p2pManager.stateManager.channelId) === selectedTarget;
        await this.p2pManager.stateManager.clearChannelId();
        timeoutManager.scheduleTask = originalScheduleTask;

        return {
            defaultTimeoutScheduled,
            nullTimeoutScheduled,
            replacementResolvedUndefined,
            replacementTopicActive,
            replacementResolvedOnLeave,
            timeoutResolvedUndefined,
            timeoutClearedTopic,
            timeoutStatus,
            disposeResolvedUndefined,
            disposeClearedTopic,
            replacementClosedOldTransport,
            leaveClosedSessionTransport,
            timeoutClosedSessionTransport,
            disposeClosedSessionTransport,
            ordinaryCancellationSucceeded,
            targetedCancellationSucceeded,
            cancellationNoopAfterHandoff,
            handedOffTransportPreservedByCancellationNoop,
            negotiationHandoffReleased,
            selectedTargetRetainedAfterRelease
        };
    }

    public async probeLobbyRetryEpoch(): Promise<LobbyRetryEpochProbe> {
        const source = new LobbyMatchingService(this.p2pManager, {
            roleDurationMinMs: 10_000,
            roleDurationMaxMs: 10_000
        });
        const observer = new LobbyMatchingService(this.p2pManager, {
            roleDurationMinMs: 10_000,
            roleDurationMaxMs: 10_000
        });
        const topic = `0x${"71".repeat(32)}`;
        const bootstrapAddress = getChecksumAddress(
            "0xffffffffffffffffffffffffffffffffffffffff"
        );
        const sourceAddress = getChecksumAddress(
            "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
        );
        const bootstrapTransport = this.transport(bootstrapAddress);
        const sourceTransport = this.transport(sourceAddress);
        this.p2pManager.profileManager.registerProfile(
            new PeerProfile(bootstrapTransport, bootstrapAddress)
        );
        this.p2pManager.profileManager.registerProfile(
            new PeerProfile(sourceTransport, sourceAddress)
        );

        const observerMatch = observer.match(topic);
        const firstMatch = source.match(topic);
        await Promise.resolve();
        observer.receiveAvailability(bootstrapTransport, {
            topic,
            role: "selector",
            roleEpoch: 0,
            available: false
        });
        source.receiveAvailability(bootstrapTransport, {
            topic,
            role: "selector",
            roleEpoch: 0,
            available: false
        });
        const firstAvailability = source.getAvailability();
        const firstRoleEpoch = firstAvailability.roleEpoch;
        observer.receiveAvailability(sourceTransport, {
            topic,
            role: firstAvailability.role,
            roleEpoch: firstRoleEpoch,
            available: true
        });
        const observerCandidateCountAfterFirstSession =
            observer.getAvailability().candidateCount;
        await source.cancelMatching(topic);
        await firstMatch;

        const secondMatch = source.match(topic);
        await Promise.resolve();
        source.receiveAvailability(bootstrapTransport, {
            topic,
            role: "selector",
            roleEpoch: 1,
            available: false
        });
        const secondAvailability = source.getAvailability();
        const secondRoleEpoch = secondAvailability.roleEpoch;
        observer.receiveAvailability(sourceTransport, {
            topic,
            role: secondAvailability.role,
            roleEpoch: secondRoleEpoch,
            available: true
        });
        const observerCandidateCountAfterRetry =
            observer.getAvailability().candidateCount;
        await source.cancelMatching(topic);
        await secondMatch;
        await observer.cancelMatching(topic);
        await observerMatch;

        return {
            firstRoleEpoch,
            secondRoleEpoch,
            observerCandidateCountAfterFirstSession,
            observerCandidateCountAfterRetry
        };
    }

    public async probeLobbyExhaustionTimer(): Promise<LobbyExhaustionTimerProbe> {
        const timeoutManager = this.p2pManager.stateManager.timeoutManager;
        const originalScheduleTask =
            timeoutManager.scheduleTask.bind(timeoutManager);
        let roleTimerSchedules = 0;
        timeoutManager.scheduleTask = ((task, delayMs, taskName) => {
            if (taskName === "lobby role duration") roleTimerSchedules += 1;
            return originalScheduleTask(task, delayMs, taskName);
        }) as typeof timeoutManager.scheduleTask;
        const service = new LobbyMatchingService(this.p2pManager, {
            roleDurationMinMs: 10_000,
            roleDurationMaxMs: 10_000
        });
        const topic = `0x${"72".repeat(32)}`;
        const peerAddress = getChecksumAddress(
            "0xffffffffffffffffffffffffffffffffffffffff"
        );
        const transport = this.transport(peerAddress);
        this.p2pManager.profileManager.registerProfile(
            new PeerProfile(transport, peerAddress)
        );
        try {
            const match = service.match(topic);
            await Promise.resolve();
            service.receiveAvailability(transport, {
                topic,
                role: "advertiser",
                roleEpoch: 0,
                available: false
            });
            await Promise.resolve();
            const scheduledAfterExhaustion = roleTimerSchedules;
            for (let roleEpoch = 1; roleEpoch <= 5; roleEpoch += 1) {
                service.receiveAvailability(transport, {
                    topic,
                    role: "advertiser",
                    roleEpoch,
                    available: false
                });
            }
            await Promise.resolve();
            const scheduledAfterRepeatedAvailability = roleTimerSchedules;
            await service.cancelMatching(topic);
            await match;
            return {
                scheduledAfterExhaustion,
                scheduledAfterRepeatedAvailability
            };
        } finally {
            timeoutManager.scheduleTask = originalScheduleTask;
            await service.dispose();
        }
    }

    public async probeLobbyLatePick(): Promise<LobbyLatePickProbe> {
        const service = new LobbyMatchingService(this.p2pManager, {
            roleDurationMinMs: 10_000,
            roleDurationMaxMs: 10_000
        });
        const topic = `0x${"73".repeat(32)}`;
        const selectorAddress = getChecksumAddress(
            "0xffffffffffffffffffffffffffffffffffffffff"
        );
        const selector = this.transport(selectorAddress);
        this.p2pManager.profileManager.registerProfile(
            new PeerProfile(selector, selectorAddress)
        );
        const lateRequesterAddress = getChecksumAddress(
            "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
        );
        const lateRequester = this.transport(lateRequesterAddress);
        const lateRequesterProfile = new PeerProfile(
            lateRequester,
            lateRequesterAddress
        );
        this.p2pManager.profileManager.registerProfile(lateRequesterProfile);

        const match = service.match(topic);
        await Promise.resolve();
        service.receiveAvailability(selector, {
            topic,
            role: "none",
            roleEpoch: 0,
            available: false
        });
        const attemptNonce = `0x${"74".repeat(32)}`;
        const selectorChallenge = `0x${"75".repeat(32)}`;
        const pick = service.receivePick(
            selector,
            attemptNonce,
            service.getAvailability().roleEpoch,
            selectorChallenge
        );
        if (pick.status !== "accepted") {
            throw new Error("Expected the committed selector to be accepted");
        }
        service.receiveCommit(
            selector,
            attemptNonce,
            service.getAvailability().roleEpoch,
            selectorChallenge,
            pick.advertiserChallenge
        );
        await match;

        service.runRPC(
            {
                service: "lobbyMatchingService",
                method: "pick",
                params: [
                    topic,
                    `0x${"76".repeat(32)}`,
                    service.getAvailability().roleEpoch,
                    `0x${"77".repeat(32)}`
                ],
                requestId: "late-pick"
            },
            lateRequester
        );
        await Promise.resolve();
        const response = lateRequester.frames
            .map((frame) => JSON.parse(frame) as Record<string, unknown>)
            .find((frame) => frame.requestId === "late-pick");
        const result = response?.result as { status?: string } | undefined;
        await service.cancelMatching(topic);
        return {
            responseStatus: result?.status ?? "missing",
            requesterBlacklisted: lateRequesterProfile.isBlackListed
        };
    }

    public async probeMatchedNegotiationAdmission(): Promise<MatchedNegotiationAdmissionProbe> {
        const service = this.p2pManager.localRpc.openChannelNegotiationService;
        const peerAddress = getChecksumAddress(
            "0xffffffffffffffffffffffffffffffffffffffff"
        );
        const transport = this.transport(peerAddress);
        const profile = new PeerProfile(transport, peerAddress);
        this.p2pManager.profileManager.registerProfile(profile);
        this.p2pManager.stateManager.setStatus(Status.DISCOVERING);
        const lobby = this.p2pManager.localRpc.lobbyMatchingService;
        const topic = `0x${"10".repeat(32)}`;
        const attemptNonce = `0x${"11".repeat(32)}`;
        const selectorChallenge = `0x${"12".repeat(32)}`;
        const matchPromise = lobby.match(topic);
        await Promise.resolve();
        lobby.receiveAvailability(transport, {
            topic,
            role: "none",
            roleEpoch: 0,
            available: false
        });
        const pick = lobby.receivePick(
            transport,
            attemptNonce,
            1,
            selectorChallenge
        );
        if (pick.status !== "accepted") {
            throw new Error("Expected lobby reservation before negotiation");
        }
        lobby.receiveCommit(
            transport,
            attemptNonce,
            1,
            selectorChallenge,
            pick.advertiserChallenge
        );
        const match = await matchPromise;
        if (!match) throw new Error("Expected committed lobby match");
        const rpc: Rpc = {
            service: "openChannelNegotiationService",
            method: "exchangeTerms",
            params: [
                match.attemptNonce,
                match.selectorChallenge,
                match.advertiserChallenge,
                this.encodeBalance(1)
            ],
            requestId: "early-negotiation"
        };

        service.runRPC(rpc, transport);
        const responseBeforeInitialization = transport.frames.length > 0;
        const { outcome } = await this.startNegotiation(service, match);
        for (let retry = 0; retry < 50; retry += 1) {
            if (
                transport.frames.some((frame) => {
                    const parsed = JSON.parse(frame) as {
                        requestId?: string;
                    };
                    return parsed.requestId === "early-negotiation";
                })
            ) {
                break;
            }
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
        const selectedChannelId = String(
            this.p2pManager.stateManager.channelId
        );
        const responseAfterInitialization = transport.frames.some((frame) => {
            const parsed = JSON.parse(frame) as { requestId?: string };
            return parsed.requestId === "early-negotiation";
        });

        this.p2pManager.profileManager.removeTransport(transport);
        await outcome;
        return {
            responseBeforeInitialization,
            responseAfterInitialization,
            selectedChannelId,
            peerBlacklistedAfterLoss:
                this.p2pManager.profileManager.getProfileByEvmAddress(
                    peerAddress
                )?.isBlackListed ?? false,
            channelIdAfterLoss: String(this.p2pManager.stateManager.channelId),
            statusAfterLoss: this.p2pManager.stateManager.status
        };
    }

    public async probeInvalidNegotiationAmount(): Promise<InvalidNegotiationAmountProbe> {
        const service = this.p2pManager.localRpc.openChannelNegotiationService;
        const peerAddress = getChecksumAddress(
            "0xffffffffffffffffffffffffffffffffffffffff"
        );
        const transport = this.transport(peerAddress);
        const profile = new PeerProfile(transport, peerAddress);
        this.p2pManager.profileManager.registerProfile(profile);
        const lobby = this.p2pManager.localRpc.lobbyMatchingService;
        const topic = `0x${"24".repeat(32)}`;
        this.p2pManager.stateManager.setStatus(Status.DISCOVERING);
        const attemptNonce = `0x${"21".repeat(32)}`;
        const selectorChallenge = `0x${"22".repeat(32)}`;
        const matchPromise = lobby.match(topic);
        await Promise.resolve();
        lobby.receiveAvailability(transport, {
            topic,
            role: "none",
            roleEpoch: 0,
            available: false
        });
        const pick = lobby.receivePick(
            transport,
            attemptNonce,
            1,
            selectorChallenge
        );
        if (pick.status !== "accepted") {
            throw new Error("Expected lobby reservation before negotiation");
        }
        lobby.receiveCommit(
            transport,
            attemptNonce,
            1,
            selectorChallenge,
            pick.advertiserChallenge
        );
        const match = await matchPromise;
        if (!match) throw new Error("Expected committed lobby match");
        const { outcome: outcomePromise } = await this.startNegotiation(
            service,
            match
        );

        let error = "";
        try {
            await service.acceptTerms(
                transport,
                match.attemptNonce,
                match.selectorChallenge,
                match.advertiserChallenge,
                "0x"
            );
        } catch (caught) {
            error = caught instanceof Error ? caught.message : String(caught);
        }
        const outcome = await outcomePromise;
        if (outcome.status === "retry") {
            await lobby.releaseNegotiationHandoff(topic);
            this.p2pManager.stateManager.setStatus(Status.DISCOVERING);
            void lobby.match(topic);
        }
        for (let retry = 0; retry < 50; retry += 1) {
            if (lobby.getAvailability().matching) break;
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
        const availability = lobby.getAvailability();
        return {
            error,
            peerBlacklisted: profile.isBlackListed,
            channelId: String(this.p2pManager.stateManager.channelId),
            status: this.p2pManager.stateManager.status,
            rendezvousTopic: availability.topic,
            matching: availability.matching,
            oldLobbyTransportClosed: transport.isClosed
        };
    }

    public async probeNegotiationFailure(
        scenario: NegotiationFailureScenario
    ): Promise<Partial<NegotiationFailureProbe>> {
        const localAddress = getChecksumAddress(
            String(this.p2pManager.stateManager.signerAddress)
        );
        const makeMatch = (peerAddress: string, seed: string) => ({
            peerAddress: getChecksumAddress(peerAddress),
            attemptNonce: `0x${seed.repeat(32)}`,
            selectorAddress: getChecksumAddress(peerAddress),
            advertiserAddress: localAddress,
            selectorChallenge: `0x${"a1".repeat(32)}`,
            advertiserChallenge: `0x${"b1".repeat(32)}`
        });
        const resetLifecycle = async () => {
            await this.p2pManager.stateManager.clearChannelId();
            this.p2pManager.stateManager.setStatus(Status.DISCOVERING);
        };

        if (scenario === "initiator-timeout") {
            await resetLifecycle();
            const timeoutPeer = getChecksumAddress(
                "0x0000000000000000000000000000000000000001"
            );
            const timeoutTransport = this.transport(timeoutPeer);
            const timeoutProfile = new PeerProfile(
                timeoutTransport,
                timeoutPeer
            );
            this.p2pManager.profileManager.registerProfile(timeoutProfile);
            const timeoutService = new OpenChannelNegotiationService(
                this.p2pManager
            );
            const timeoutManager = this.p2pManager.stateManager.timeoutManager;
            const originalScheduleTask =
                timeoutManager.scheduleTask.bind(timeoutManager);
            let initiatorDeadline: (() => void | Promise<void>) | undefined;
            timeoutManager.scheduleTask = ((task, delayMs, taskName) => {
                if (taskName === "matched negotiation initiator deadline") {
                    initiatorDeadline = task;
                }
                return originalScheduleTask(task, delayMs, taskName);
            }) as typeof timeoutManager.scheduleTask;
            const timeoutMatch = makeMatch(timeoutPeer, "71");
            const { outcome: timeoutOutcome } = await this.startNegotiation(
                timeoutService,
                timeoutMatch
            );
            const channelIdAfterHigherInit = String(
                this.p2pManager.stateManager.channelId
            );
            await initiatorDeadline?.();
            await timeoutOutcome;
            await Promise.resolve();
            await Promise.resolve();
            timeoutManager.scheduleTask = originalScheduleTask;
            const initiatorTimeoutBlacklisted = timeoutProfile.isBlackListed;
            const initiatorTimeoutCleared =
                !timeoutService.state.attempt &&
                String(this.p2pManager.stateManager.channelId) ===
                    `0x${"00".repeat(32)}`;
            return {
                channelIdAfterHigherInit,
                initiatorTimeoutBlacklisted,
                initiatorTimeoutCleared
            };
        }

        if (scenario === "wrong-peer") {
            await resetLifecycle();
            const selectedPeer = getChecksumAddress(
                "0x0000000000000000000000000000000000000002"
            );
            const wrongPeer = getChecksumAddress(
                "0x0000000000000000000000000000000000000003"
            );
            const selectedTransport = this.transport(selectedPeer);
            const wrongTransport = this.transport(wrongPeer);
            const selectedProfile = new PeerProfile(
                selectedTransport,
                selectedPeer
            );
            const wrongProfile = new PeerProfile(wrongTransport, wrongPeer);
            this.p2pManager.profileManager.registerProfile(selectedProfile);
            this.p2pManager.profileManager.registerProfile(wrongProfile);
            const wrongPeerService = new OpenChannelNegotiationService(
                this.p2pManager
            );
            const selectedMatch = makeMatch(selectedPeer, "72");
            await this.startNegotiation(wrongPeerService, selectedMatch);
            wrongPeerService.runRPC(
                {
                    service: "openChannelNegotiationService",
                    method: "exchangeTerms",
                    params: [
                        selectedMatch.attemptNonce,
                        selectedMatch.selectorChallenge,
                        selectedMatch.advertiserChallenge,
                        this.encodeBalance(1)
                    ]
                },
                wrongTransport
            );
            const wrongPeerBlacklisted = wrongProfile.isBlackListed;
            const wrongPeerLeftAttemptActive = !!wrongPeerService.state.attempt;
            await wrongPeerService.dispose();
            return { wrongPeerBlacklisted, wrongPeerLeftAttemptActive };
        }

        if (scenario === "wrong-attempt") {
            await resetLifecycle();
            const wrongAttemptPeer = getChecksumAddress(
                "0x0000000000000000000000000000000000000004"
            );
            const wrongAttemptTransport = this.transport(wrongAttemptPeer);
            const wrongAttemptProfile = new PeerProfile(
                wrongAttemptTransport,
                wrongAttemptPeer
            );
            this.p2pManager.profileManager.registerProfile(wrongAttemptProfile);
            const wrongAttemptService = new OpenChannelNegotiationService(
                this.p2pManager
            );
            const wrongAttemptMatch = makeMatch(wrongAttemptPeer, "73");
            const { outcome: wrongAttemptOutcome } =
                await this.startNegotiation(
                    wrongAttemptService,
                    wrongAttemptMatch
                );
            wrongAttemptService.runRPC(
                {
                    service: "openChannelNegotiationService",
                    method: "exchangeTerms",
                    params: [
                        `0x${"74".repeat(32)}`,
                        wrongAttemptMatch.selectorChallenge,
                        wrongAttemptMatch.advertiserChallenge,
                        this.encodeBalance(1)
                    ]
                },
                wrongAttemptTransport
            );
            await Promise.resolve();
            await Promise.resolve();
            await wrongAttemptOutcome;
            const wrongAttemptBlacklistedSelectedPeer =
                wrongAttemptProfile.isBlackListed;
            const wrongAttemptCleared = !wrongAttemptService.state.attempt;
            return {
                wrongAttemptBlacklistedSelectedPeer,
                wrongAttemptCleared
            };
        }

        if (scenario === "terms") {
            await resetLifecycle();
            const duplicatePeer = getChecksumAddress(
                "0x0000000000000000000000000000000000000005"
            );
            const duplicateTransport = this.transport(duplicatePeer);
            const duplicateProfile = new PeerProfile(
                duplicateTransport,
                duplicatePeer
            );
            this.p2pManager.profileManager.registerProfile(duplicateProfile);
            const duplicateService = new OpenChannelNegotiationService(
                this.p2pManager
            );
            const duplicateMatch = makeMatch(duplicatePeer, "75");
            const { outcome: duplicateOutcome } = await this.startNegotiation(
                duplicateService,
                duplicateMatch
            );
            const firstTerms = await duplicateService.acceptTerms(
                duplicateTransport,
                duplicateMatch.attemptNonce,
                duplicateMatch.selectorChallenge,
                duplicateMatch.advertiserChallenge,
                this.encodeBalance(7)
            );
            const repeatedTerms = await duplicateService.acceptTerms(
                duplicateTransport,
                duplicateMatch.attemptNonce,
                duplicateMatch.selectorChallenge,
                duplicateMatch.advertiserChallenge,
                this.encodeBalance(7)
            );
            const duplicateTermsIdempotent =
                firstTerms.encodedBalance === repeatedTerms.encodedBalance &&
                !!duplicateService.state.attempt;
            try {
                await duplicateService.acceptTerms(
                    duplicateTransport,
                    duplicateMatch.attemptNonce,
                    duplicateMatch.selectorChallenge,
                    duplicateMatch.advertiserChallenge,
                    this.encodeBalance(8)
                );
            } catch {}
            await Promise.resolve();
            await Promise.resolve();
            await duplicateOutcome;
            const conflictingTermsBlacklisted = duplicateProfile.isBlackListed;
            return { duplicateTermsIdempotent, conflictingTermsBlacklisted };
        }

        if (scenario === "malformed-proposal") {
            await resetLifecycle();
            const malformedPeer = getChecksumAddress(
                "0x0000000000000000000000000000000000000006"
            );
            const malformedTransport = this.transport(malformedPeer);
            const malformedProfile = new PeerProfile(
                malformedTransport,
                malformedPeer
            );
            this.p2pManager.profileManager.registerProfile(malformedProfile);
            const malformedService = new OpenChannelNegotiationService(
                this.p2pManager
            );
            const malformedMatch = makeMatch(malformedPeer, "76");
            const { outcome: malformedOutcome } = await this.startNegotiation(
                malformedService,
                malformedMatch
            );
            await malformedService.acceptTerms(
                malformedTransport,
                malformedMatch.attemptNonce,
                malformedMatch.selectorChallenge,
                malformedMatch.advertiserChallenge,
                this.encodeBalance(1)
            );
            try {
                await malformedService.acceptOpenProposal(
                    malformedTransport,
                    malformedMatch.attemptNonce,
                    malformedMatch.selectorChallenge,
                    malformedMatch.advertiserChallenge,
                    "0x",
                    "0x"
                );
            } catch {}
            await Promise.resolve();
            await Promise.resolve();
            await malformedOutcome;
            const malformedProposalBlacklisted = malformedProfile.isBlackListed;
            const malformedProposalCleared = !malformedService.state.attempt;
            return {
                malformedProposalBlacklisted,
                malformedProposalCleared
            };
        }

        if (scenario === "already-open") {
            await resetLifecycle();
            const collisionWallet = ethers.Wallet.createRandom();
            const collisionPeer = getChecksumAddress(collisionWallet.address);
            const collisionTransport = this.transport(collisionPeer);
            const collisionProfile = new PeerProfile(
                collisionTransport,
                collisionPeer
            );
            this.p2pManager.profileManager.registerProfile(collisionProfile);
            const collisionService = new OpenChannelNegotiationService(
                this.p2pManager
            );
            const collisionMatch = makeMatch(collisionPeer, "77");
            const collisionChannelId =
                deriveNegotiatedChannelId(collisionMatch);
            const participants =
                compareAddresses(localAddress, collisionPeer) < 0
                    ? [localAddress, collisionPeer]
                    : [collisionPeer, localAddress];
            const openChannel = {
                ...createOpenChannelTestObject(participants),
                channelId: collisionChannelId
            };
            const localOpening = await SignatureUtils.signOpenChannel(
                openChannel,
                this.p2pManager.stateManager.signer
            );
            const peerOpening = await SignatureUtils.signOpenChannel(
                openChannel,
                collisionWallet
            );
            await (
                await this.p2pManager.stateManager.stateChannelManagerContract.open(
                    {
                        encodedOpenChannel: localOpening.encoded,
                        signatures: [
                            localOpening.signature as Bytes,
                            peerOpening.signature as Bytes
                        ]
                    }
                )
            ).wait();
            let alreadyOpenRejected = false;
            const collisionOutcome =
                await collisionService.initMatchedNegotiation(collisionMatch);
            alreadyOpenRejected = collisionOutcome.status === "retry";
            const alreadyOpenBlacklisted = collisionProfile.isBlackListed;
            const alreadyOpenKeptZeroId =
                String(this.p2pManager.stateManager.channelId) ===
                `0x${"00".repeat(32)}`;

            return {
                alreadyOpenRejected,
                alreadyOpenBlacklisted,
                alreadyOpenKeptZeroId
            };
        }

        throw new Error(`Unknown negotiation failure scenario: ${scenario}`);
    }

    public async probeSignedAttemptObservation(): Promise<SignedAttemptObservationProbe> {
        const localAddress = getChecksumAddress(
            String(this.p2pManager.stateManager.signerAddress)
        );
        const resetLifecycle = async () => {
            await this.p2pManager.stateManager.clearChannelId();
            this.p2pManager.stateManager.setStatus(Status.DISCOVERING);
        };
        const lowerWallet = () => {
            let wallet = ethers.Wallet.createRandom();
            while (compareAddresses(wallet.address, localAddress) >= 0) {
                wallet = ethers.Wallet.createRandom();
            }
            return wallet;
        };
        const makeMatch = (peerAddress: string, seed: string) => ({
            peerAddress: getChecksumAddress(peerAddress),
            attemptNonce: `0x${seed.repeat(32)}`,
            selectorAddress: getChecksumAddress(peerAddress),
            advertiserAddress: localAddress,
            selectorChallenge: `0x${"c1".repeat(32)}`,
            advertiserChallenge: `0x${"d1".repeat(32)}`
        });

        await resetLifecycle();
        const wallet = lowerWallet();
        const peerAddress = getChecksumAddress(wallet.address);
        const transport = this.transport(peerAddress);
        const profile = new PeerProfile(transport, peerAddress);
        this.p2pManager.profileManager.registerProfile(profile);
        const service = new OpenChannelNegotiationService(this.p2pManager);
        const timeoutManager = this.p2pManager.stateManager.timeoutManager;
        const originalScheduleTask =
            timeoutManager.scheduleTask.bind(timeoutManager);
        let expiryTask: (() => void | Promise<void>) | undefined;
        timeoutManager.scheduleTask = ((task, delayMs, taskName) => {
            if (taskName === "opening payload expiry observation") {
                expiryTask = task;
            }
            return originalScheduleTask(task, delayMs, taskName);
        }) as typeof timeoutManager.scheduleTask;
        const match = makeMatch(peerAddress, "81");
        const { outcome: serviceOutcome } = await this.startNegotiation(
            service,
            match
        );
        await service.acceptTerms(
            transport,
            match.attemptNonce,
            match.selectorChallenge,
            match.advertiserChallenge,
            this.encodeBalance(500)
        );
        const channelId = service.state.attempt!.channelId;
        const proposal = {
            channelId,
            participants: [peerAddress, localAddress],
            balances: [
                { amount: 500, data: "0x" },
                { amount: 500, data: "0x" }
            ],
            deadlineTimestamp: Clock.getTimeInSeconds() + 60,
            isAtomic: true,
            data: "0x"
        };
        const signed = await SignatureUtils.signOpenChannel(proposal, wallet);
        const manager =
            this.p2pManager.stateManager.stateChannelManagerContract;
        const originalOpen = manager.open;
        let submittedOpen:
            | { encodedOpenChannel: string; signatures: string[] }
            | undefined;
        manager.open = (async (request: unknown) => {
            submittedOpen = request as {
                encodedOpenChannel: string;
                signatures: string[];
            };
            throw new Error("forced opening submission failure");
        }) as unknown as typeof manager.open;
        let submissionFailureThrew = false;
        try {
            await service.acceptOpenProposal(
                transport,
                match.attemptNonce,
                match.selectorChallenge,
                match.advertiserChallenge,
                signed.encoded.toString(),
                signed.signature.toString()
            );
        } catch {
            submissionFailureThrew = true;
        } finally {
            manager.open = originalOpen;
        }
        const higherSubmittedExactPayload =
            submittedOpen?.encodedOpenChannel === signed.encoded.toString();
        const higherSubmittedBothSignatures =
            submittedOpen?.signatures.length === 2 &&
            submittedOpen.signatures[0] === signed.signature.toString() &&
            getChecksumAddress(
                SignatureUtils.getSignerAddress(
                    signed.encoded,
                    submittedOpen.signatures[1]
                ).toString()
            ) === localAddress;
        const signedAttemptRetainedAfterSubmissionFailure =
            !!service.state.attempt;
        const submissionFailureDidNotReportOpen = !service.state.channelOpened;
        const higherDidNotBlacklistLowerAfterSubmissionFailure =
            !profile.isBlackListed;
        await expiryTask?.();
        await Promise.resolve();
        await Promise.resolve();
        const higherDidNotBlacklistLowerAfterExpiry = !profile.isBlackListed;
        timeoutManager.scheduleTask = originalScheduleTask;
        const signedAttemptClearedAfterExpiry = !service.state.attempt;
        const signedAttemptIdClearedAfterExpiry =
            String(this.p2pManager.stateManager.channelId) === ethers.ZeroHash;
        await serviceOutcome;

        await resetLifecycle();
        const lossWallet = lowerWallet();
        const lossPeer = getChecksumAddress(lossWallet.address);
        const lossTransport = this.transport(lossPeer);
        const lossProfile = new PeerProfile(lossTransport, lossPeer);
        this.p2pManager.profileManager.registerProfile(lossProfile);
        const lossService = new OpenChannelNegotiationService(this.p2pManager);
        const lossMatch = makeMatch(lossPeer, "86");
        const { outcome: lossOutcome } = await this.startNegotiation(
            lossService,
            lossMatch
        );
        lossService.state.attempt!.localOpeningSignatureIssued = true;
        this.p2pManager.profileManager.removeTransport(lossTransport);
        await Promise.resolve();
        const signedPeerBlacklistedOnFinalLoss = lossProfile.isBlackListed;
        const signedAttemptRetainedAfterFinalLoss = !!lossService.state.attempt;
        await lossService.dispose();
        await lossOutcome;

        await resetLifecycle();
        let higherWallet = ethers.Wallet.createRandom();
        while (compareAddresses(localAddress, higherWallet.address) >= 0) {
            higherWallet = ethers.Wallet.createRandom();
        }
        const higherPeer = getChecksumAddress(higherWallet.address);
        const higherTransport = this.transport(higherPeer);
        const higherProfile = new PeerProfile(higherTransport, higherPeer);
        this.p2pManager.profileManager.registerProfile(higherProfile);
        const lowerService = new OpenChannelNegotiationService(this.p2pManager);
        const lowerMatch = makeMatch(higherPeer, "84");
        const { outcome: lowerOutcome } = await this.startNegotiation(
            lowerService,
            lowerMatch
        );
        const lowerAttempt = lowerService.state.attempt!;
        lowerAttempt.localOpeningSignatureIssued = true;
        let lowerExpiryTask: (() => void | Promise<void>) | undefined;
        timeoutManager.scheduleTask = ((task, delayMs, taskName) => {
            if (taskName === "opening payload expiry observation") {
                lowerExpiryTask = task;
            }
            return originalScheduleTask(task, delayMs, taskName);
        }) as typeof timeoutManager.scheduleTask;
        (
            lowerService as unknown as {
                scheduleDeadlineObservation: (
                    attempt: typeof lowerAttempt,
                    deadlineTimestamp: number
                ) => void;
            }
        ).scheduleDeadlineObservation(
            lowerAttempt,
            Clock.getTimeInSeconds() + 60
        );
        const lowerDidNotBlacklistHigherBeforeExpiry =
            !higherProfile.isBlackListed;
        await lowerExpiryTask?.();
        await Promise.resolve();
        const lowerBlacklistedHigherAfterExpiry = higherProfile.isBlackListed;
        timeoutManager.scheduleTask = originalScheduleTask;
        await lowerOutcome;

        await resetLifecycle();
        const disposePeer = getChecksumAddress(lowerWallet().address);
        const disposeTransport = this.transport(disposePeer);
        this.p2pManager.profileManager.registerProfile(
            new PeerProfile(disposeTransport, disposePeer)
        );
        const disposeService = new OpenChannelNegotiationService(
            this.p2pManager
        );
        const disposeMatch = makeMatch(disposePeer, "85");
        const { outcome: disposeOutcome } = await this.startNegotiation(
            disposeService,
            disposeMatch
        );
        const disposeAttempt = disposeService.state.attempt!;
        disposeAttempt.localOpeningSignatureIssued = true;
        await disposeService.dispose();
        const signedDisposeOutcomeCancelled =
            (await disposeOutcome).status === "cancelled";
        const signedAttemptClearedOnDispose = !disposeService.state.attempt;

        await resetLifecycle();
        const openWallet = lowerWallet();
        const openPeer = getChecksumAddress(openWallet.address);
        const openTransport = this.transport(openPeer);
        this.p2pManager.profileManager.registerProfile(
            new PeerProfile(openTransport, openPeer)
        );
        const openService = new OpenChannelNegotiationService(this.p2pManager);
        const openMatch = makeMatch(openPeer, "82");
        const { outcome: openOutcome } = await this.startNegotiation(
            openService,
            openMatch
        );
        await openService.acceptTerms(
            openTransport,
            openMatch.attemptNonce,
            openMatch.selectorChallenge,
            openMatch.advertiserChallenge,
            this.encodeBalance(500)
        );
        const openChannelId = openService.state.attempt!.channelId;
        const openProposal = {
            channelId: openChannelId,
            participants: [openPeer, localAddress],
            balances: [
                { amount: 500, data: "0x" },
                { amount: 500, data: "0x" }
            ],
            deadlineTimestamp: Clock.getTimeInSeconds() + 60,
            isAtomic: true,
            data: "0x"
        };
        const signedOpenProposal = await SignatureUtils.signOpenChannel(
            openProposal,
            openWallet
        );
        let outcomeResolved = false;
        const outcome = openOutcome.then((result) => {
            outcomeResolved = true;
            return result;
        });
        manager.open = (async () => ({
            wait: async () => undefined
        })) as unknown as typeof manager.open;
        await openService.acceptOpenProposal(
            openTransport,
            openMatch.attemptNonce,
            openMatch.selectorChallenge,
            openMatch.advertiserChallenge,
            signedOpenProposal.encoded.toString(),
            signedOpenProposal.signature.toString()
        );
        manager.open = originalOpen;
        await Promise.resolve();
        const submissionStayedPendingUntilObservation =
            !outcomeResolved && !!openService.state.attempt;
        this.p2pManager.stateManager.events.emit(
            "eventHandler",
            "onChannelOpened",
            [`0x${"83".repeat(32)}`]
        );
        const wrongOpenEventIgnored = !!openService.state.attempt;
        this.p2pManager.stateManager.events.emit(
            "eventHandler",
            "onChannelOpened",
            [openChannelId]
        );
        await outcome;
        const matchingOpenEventClearedAttempt = !openService.state.attempt;
        const matchingOpenEventRetainedChannelId =
            String(this.p2pManager.stateManager.channelId) === openChannelId;

        return {
            submissionFailureThrew,
            higherSubmittedExactPayload,
            higherSubmittedBothSignatures,
            signedAttemptRetainedAfterSubmissionFailure,
            submissionFailureDidNotReportOpen,
            higherDidNotBlacklistLowerAfterSubmissionFailure,
            higherDidNotBlacklistLowerAfterExpiry,
            lowerDidNotBlacklistHigherBeforeExpiry,
            lowerBlacklistedHigherAfterExpiry,
            signedDisposeOutcomeCancelled,
            signedAttemptClearedOnDispose,
            signedPeerBlacklistedOnFinalLoss,
            signedAttemptRetainedAfterFinalLoss,
            signedAttemptClearedAfterExpiry,
            signedAttemptIdClearedAfterExpiry,
            wrongOpenEventIgnored,
            submissionStayedPendingUntilObservation,
            matchingOpenEventClearedAttempt,
            matchingOpenEventRetainedChannelId
        };
    }

    public async probeTargetedNegotiationRaces(): Promise<TargetedNegotiationRaceProbe> {
        const stateManager = this.p2pManager.stateManager;
        const localAddress = getChecksumAddress(
            String(stateManager.signerAddress)
        );
        const lowerWallet = () => {
            let wallet = ethers.Wallet.createRandom();
            while (compareAddresses(wallet.address, localAddress) >= 0) {
                wallet = ethers.Wallet.createRandom();
            }
            return wallet;
        };
        const makeMatch = (peerAddress: string, seed: string): LobbyMatch => ({
            peerAddress: getChecksumAddress(peerAddress),
            attemptNonce: `0x${seed.repeat(32)}`,
            selectorAddress: getChecksumAddress(peerAddress),
            advertiserAddress: localAddress,
            selectorChallenge: `0x${"e1".repeat(32)}`,
            advertiserChallenge: `0x${"f1".repeat(32)}`
        });
        const prepare = async (seed: string) => {
            const wallet = lowerWallet();
            const peerAddress = getChecksumAddress(wallet.address);
            const transport = this.transport(peerAddress);
            const profile = new PeerProfile(transport, peerAddress);
            this.p2pManager.profileManager.registerProfile(profile);
            const channelId = `0x${seed.repeat(32)}`;
            await stateManager.clearChannelId();
            await stateManager.setChannelId(channelId);
            stateManager.setStatus(Status.NOT_OPENED);
            const service = new OpenChannelNegotiationService(this.p2pManager);
            const match = makeMatch(peerAddress, seed === "91" ? "93" : "94");
            const { outcome } = await this.startNegotiation(service, match, {
                mode: "targeted",
                channelId,
                balance: { amount: 500n, data: "0x1234" }
            });
            await service.acceptTerms(
                transport,
                match.attemptNonce,
                match.selectorChallenge,
                match.advertiserChallenge,
                this.encodeBalance(500, "0x5678")
            );
            const proposal = {
                channelId,
                participants: [peerAddress, localAddress],
                balances: [
                    { amount: 500n, data: "0x5678" },
                    { amount: 500n, data: "0x1234" }
                ],
                deadlineTimestamp: Clock.getTimeInSeconds() + 60,
                isAtomic: true,
                data: "0x"
            };
            const signed = await SignatureUtils.signOpenChannel(
                proposal,
                wallet
            );
            return {
                wallet,
                peerAddress,
                transport,
                profile,
                channelId,
                service,
                match,
                outcome,
                signed
            };
        };

        const signature = await prepare("91");
        const manager = stateManager.stateChannelManagerContract;
        const originalOpen = manager.open;
        let signatureSubmitCalls = 0;
        manager.open = (async () => {
            signatureSubmitCalls += 1;
            return { wait: async () => undefined };
        }) as unknown as typeof manager.open;
        const originalSign = SignatureUtils.signOpenChannel;
        let releaseSign!: () => void;
        const signGate = new Promise<void>((resolve) => {
            releaseSign = resolve;
        });
        let signEntered = false;
        SignatureUtils.signOpenChannel = (async (
            ...args: Parameters<typeof originalSign>
        ) => {
            if (args[1] === stateManager.signer) {
                signEntered = true;
                await signGate;
            }
            return originalSign.call(SignatureUtils, ...args);
        }) as typeof originalSign;
        const accepting = signature.service.acceptOpenProposal(
            signature.transport,
            signature.match.attemptNonce,
            signature.match.selectorChallenge,
            signature.match.advertiserChallenge,
            signature.signed.encoded.toString(),
            signature.signed.signature.toString()
        );
        for (let index = 0; index < 100 && !signEntered; index += 1) {
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
        stateManager.events.emit("eventHandler", "onChannelOpened", [
            signature.channelId
        ]);
        const signatureOutcome = (await signature.outcome).status;
        const signatureTargetRetained =
            String(stateManager.channelId) === signature.channelId;
        releaseSign();
        await accepting;
        SignatureUtils.signOpenChannel = originalSign;
        manager.open = originalOpen;

        const receipt = await prepare("92");
        let receiptSubmitCalls = 0;
        manager.open = (async () => {
            receiptSubmitCalls += 1;
            return {
                wait: async () => {
                    throw new Error("injected targeted receipt failure");
                }
            };
        }) as unknown as typeof manager.open;
        const originalRefresh =
            stateManager.refreshOpenedStatusFromChain.bind(stateManager);
        stateManager.refreshOpenedStatusFromChain = async () => {
            stateManager.setStatus(Status.OPENED);
            return Status.OPENED;
        };
        await receipt.service.acceptOpenProposal(
            receipt.transport,
            receipt.match.attemptNonce,
            receipt.match.selectorChallenge,
            receipt.match.advertiserChallenge,
            receipt.signed.encoded.toString(),
            receipt.signed.signature.toString()
        );
        const settled = await DetachedPromises.awaitAllAndClear();
        const receiptOutcome = (await receipt.outcome).status;
        const receiptTargetRetained =
            String(stateManager.channelId) === receipt.channelId;
        stateManager.refreshOpenedStatusFromChain = originalRefresh;
        manager.open = originalOpen;

        const unopenedReceipt = await prepare("95");
        manager.open = (async () => ({
            wait: async () => {
                throw new Error("targeted receipt failed while unopened");
            }
        })) as unknown as typeof manager.open;
        await unopenedReceipt.service.acceptOpenProposal(
            unopenedReceipt.transport,
            unopenedReceipt.match.attemptNonce,
            unopenedReceipt.match.selectorChallenge,
            unopenedReceipt.match.advertiserChallenge,
            unopenedReceipt.signed.encoded.toString(),
            unopenedReceipt.signed.signature.toString()
        );
        const unopenedSettled = await DetachedPromises.awaitAllAndClear();
        const unopenedReceiptOutcome = (await unopenedReceipt.outcome).status;
        const unopenedRejected = unopenedSettled.find(
            (entry): entry is PromiseRejectedResult =>
                entry.status === "rejected"
        );
        const unopenedReceiptError = unopenedRejected
            ? String(unopenedRejected.reason)
            : "";
        const unopenedReceiptTargetRetained =
            String(stateManager.channelId) === unopenedReceipt.channelId;
        manager.open = originalOpen;

        const ordinaryWallet = lowerWallet();
        const ordinaryPeer = getChecksumAddress(ordinaryWallet.address);
        const ordinaryTransport = this.transport(ordinaryPeer);
        const ordinaryProfile = new PeerProfile(
            ordinaryTransport,
            ordinaryPeer
        );
        this.p2pManager.profileManager.registerProfile(ordinaryProfile);
        await stateManager.clearChannelId();
        stateManager.setStatus(Status.DISCOVERING);
        const ordinaryService = new OpenChannelNegotiationService(
            this.p2pManager
        );
        const ordinaryMatch = makeMatch(ordinaryPeer, "96");
        const { outcome: ordinaryOutcome } = await this.startNegotiation(
            ordinaryService,
            ordinaryMatch
        );
        await ordinaryService.acceptTerms(
            ordinaryTransport,
            ordinaryMatch.attemptNonce,
            ordinaryMatch.selectorChallenge,
            ordinaryMatch.advertiserChallenge,
            this.encodeBalance(500, "0x5678")
        );
        const ordinaryProposal = {
            channelId: ordinaryService.state.attempt!.channelId,
            participants: [ordinaryPeer, localAddress],
            balances: [
                { amount: 500n, data: "0x5678" },
                { amount: 500n, data: "0x" }
            ],
            deadlineTimestamp: Clock.getTimeInSeconds() + 60,
            isAtomic: true,
            data: "0x"
        };
        const ordinarySigned = await SignatureUtils.signOpenChannel(
            ordinaryProposal,
            ordinaryWallet
        );
        manager.open = (async () => ({
            wait: async () => {
                throw new Error("ordinary receipt failure");
            }
        })) as unknown as typeof manager.open;
        await ordinaryService.acceptOpenProposal(
            ordinaryTransport,
            ordinaryMatch.attemptNonce,
            ordinaryMatch.selectorChallenge,
            ordinaryMatch.advertiserChallenge,
            ordinarySigned.encoded.toString(),
            ordinarySigned.signature.toString()
        );
        const ordinarySettled = await DetachedPromises.awaitAllAndClear();
        const ordinaryReceiptOutcome = (await ordinaryOutcome).status;
        const ordinaryRejected = ordinarySettled.find(
            (entry): entry is PromiseRejectedResult =>
                entry.status === "rejected"
        );
        manager.open = originalOpen;

        return {
            signatureOutcome,
            signatureSubmitCalls,
            signaturePeerBlacklisted: signature.profile.isBlackListed,
            signatureAttemptCleared: !signature.service.state.attempt,
            signatureTargetRetained,
            receiptOutcome,
            receiptSubmitCalls,
            receiptPeerBlacklisted: receipt.profile.isBlackListed,
            receiptAttemptCleared: !receipt.service.state.attempt,
            receiptTargetRetained,
            detachedErrors: settled.filter(
                (entry) => entry.status === "rejected"
            ).length,
            unopenedReceiptOutcome,
            unopenedReceiptError,
            unopenedReceiptPeerBlacklisted:
                unopenedReceipt.profile.isBlackListed,
            unopenedReceiptTargetRetained,
            ordinaryReceiptOutcome,
            ordinaryReceiptError: ordinaryRejected
                ? String(ordinaryRejected.reason)
                : "",
            ordinaryReceiptPeerBlacklisted: ordinaryProfile.isBlackListed,
            ordinaryReceiptChannelCleared:
                String(stateManager.channelId) === ethers.ZeroHash
        };
    }

    private async startNegotiation(
        service: OpenChannelNegotiationService,
        match: LobbyMatch,
        options: MatchedNegotiationOptions = {}
    ): Promise<{ outcome: Promise<NegotiationOutcome> }> {
        const outcome = service.initMatchedNegotiation(match, options);
        for (let attempt = 0; attempt < 100; attempt += 1) {
            if (service.state.attempt) return { outcome };
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
        throw new Error("Negotiation attempt did not initialize");
    }

    private encodeBalance(amount: bigint | number, data = "0x"): string {
        return String(Codec.encode({ amount, data }, Type.Balance));
    }
}
