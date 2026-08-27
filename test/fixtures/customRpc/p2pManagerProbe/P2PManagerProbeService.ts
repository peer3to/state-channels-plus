// @spec-test-coverage-ignore: worker-side support service for mapped P2PManager component cases
import type P2PManager from "@/P2PManager";
import ARpcService from "@/rpc/ARpcService";
import type Rpc from "@/rpc/Rpc";
import { MAX_RPC_FRAME_BYTES } from "@/rpc/Rpc";
import ATransport from "@/transport/ATransport";
import { TransportType } from "@/transport/TransportType";
import PeerProfile from "@/PeerProfile";
import { getChecksumAddress } from "@/utils";
import { Buffer } from "buffer";
import { Status } from "@/types";
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
    exactLimitAccepted: boolean;
    malformedDisconnected: boolean;
    unknownServiceDisconnected: boolean;
    responseClassifiedBeforeDispatch: boolean;
};

export type FrameByteBoundaryProbe = {
    multibyteExactAccepted: boolean;
    multibyteOverDisconnected: boolean;
    validJsonInvalidEnvelopeDisconnected: boolean;
};

export type DispatchOutcomeProbe = {
    validMethodStayedConnected: boolean;
    validMethodCalls: number;
    unknownMethodDisconnected: boolean;
    throwingServiceDisconnected: boolean;
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
    secondFrameIgnored: boolean;
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
    missingAddressIgnored: boolean;
    connectedPeers: string[];
    discoveryWasNodeNoop: boolean;
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
        const oversized = this.transport();
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

        const malformed = this.transport();
        this.p2pManager.addConnection(malformed);
        this.p2pManager.onRpc("{", malformed);

        const unknownService = this.transport();
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
            exactLimitAccepted: this.p2pManager.openConnections.includes(exact),
            malformedDisconnected:
                !this.p2pManager.openConnections.includes(malformed),
            unknownServiceDisconnected:
                !this.p2pManager.openConnections.includes(unknownService),
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

        const over = this.transport();
        this.p2pManager.addConnection(over);
        this.p2pManager.onRpc(`${exactFrame}x`, over);

        const invalidEnvelope = this.transport();
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
            validJsonInvalidEnvelopeDisconnected:
                !this.p2pManager.openConnections.includes(invalidEnvelope)
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

        const unknownMethod = this.transport();
        this.p2pManager.addConnection(unknownMethod);
        this.p2pManager.onRpc(
            JSON.stringify({
                service: "p2pManagerProbe",
                method: "absent",
                params: []
            }),
            unknownMethod
        );

        const throwing = this.transport();
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
            throwingServiceDisconnected:
                !this.p2pManager.openConnections.includes(throwing)
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
            secondFrameIgnored:
                this.p2pManager.openConnections.includes(transport),
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
            secondFrameIgnored: true,
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
            secondFrameIgnored: true,
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
            secondFrameIgnored: true,
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
            secondFrameIgnored: true,
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
            secondFrameIgnored: true,
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
        const replacement = this.transport();
        const profile = new PeerProfile(oldTransport, address);
        this.p2pManager.profileManager.registerProfile(profile);
        this.p2pManager.addConnection(oldTransport);
        const oldRequest = this.beginRequest(oldTransport, 1000);
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
                oldRequestError: await oldRequest.promise.catch(
                    (error: Error) => error.message
                ),
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
        const replacement = this.transport(address.toLowerCase());
        const replacementRequest = this.beginRequest(original);
        this.response(
            replacement,
            replacementRequest.requestId,
            true,
            "replacement"
        );

        const unknown = this.transport();
        this.p2pManager.addConnection(unknown);
        this.response(unknown, "absent", true, "ignored");

        const duplicate = this.transport(address);
        this.p2pManager.addConnection(duplicate);
        const duplicateRequest = this.beginRequest(duplicate);
        this.response(duplicate, duplicateRequest.requestId, true, "once");
        await duplicateRequest.promise;
        this.response(duplicate, duplicateRequest.requestId, true, "twice");

        const pending = this.transport(address);
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
        this.p2pManager.disconnectAndBlacklistPeer(first);
        this.p2pManager.disconnectAndBlacklistPeerByEvmAddress(secondAddress);
        this.p2pManager.disconnectAndBlacklistPeerByEvmAddress(missingAddress);

        const beforeDiscovery = this.p2pManager.openConnections.length;
        await this.p2pManager.tryOpenConnectionToChannel("p2p-manager-probe");

        return {
            broadcastCounts,
            duplicateAddCount,
            disconnectedCount: [first, second].filter(
                (transport) =>
                    !this.p2pManager.openConnections.includes(transport)
            ).length,
            blacklistByTransport: firstProfile.isBlackListed,
            blacklistByAddress: secondProfile.isBlackListed,
            missingAddressIgnored:
                !this.p2pManager.isBlacklisted(missingAddress),
            connectedPeers,
            discoveryWasNodeNoop:
                this.p2pManager.openConnections.length === beforeDiscovery
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
}
