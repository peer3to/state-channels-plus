// @spec-test-coverage-ignore: host-side LocalOnlyGuard observation for guard tests
import type { PingPongRpc } from "../PingPongRpcManifest";
import type { LocalOnlyGuardChainTargetService } from "./LocalOnlyGuardChainTargetService";
import { LocalOnlyGuardProbeRpcMethods } from "./LocalOnlyGuardProbeRpcMethods";
import type { LocalOnlyGuardTargetService } from "./LocalOnlyGuardTargetService";
import { DisconnectTier } from "@/DisconnectPolicy";
import type P2PManager from "@/P2PManager";
import type PeerProfile from "@/PeerProfile";
import ANetworkRpcService from "@/rpc/network/ANetworkRpcService";
import type Rpc from "@/rpc/Rpc";
import type { RpcResponse } from "@/rpc/Rpc";
import NetworkTransport from "@/transport/NetworkTransport";

/** Serializable projection of one call that reached a local-only guarded service. */
export type LocalOnlyDelivery = {
    service: string;
    method: string;
    value: string;
    /** The call carried a request id, so a response was due. */
    request: boolean;
    trusted: boolean;
    /** State of the receiving transport when the call arrived. */
    proven: boolean;
    negotiating: boolean;
    profile: boolean;
    /** State after the call: the profile charged at arrival and the transport. */
    profileBlacklisted: boolean;
    transportClosed: boolean;
    transportOpen: boolean;
    localOnlySuppressed: boolean;
    /** Dispatcher response sends started for this exact call. */
    responseAttempts: number;
    /** Response frames sent to this peer for this call's request id. */
    responseFrames: RpcResponse[];
};

/**
 * One call to the canonical disconnect owner. `origin` separates the
 * transport's own close bookkeeping (NetworkTransport.afterClose) and the
 * dispatcher's response-failure path from every other caller.
 */
export type LocalOnlyDisconnect = {
    tier: string;
    reason: string | null;
    origin: "close-bookkeeping" | "response-failure" | "direct";
};

export type LocalOnlyObservation = {
    deliveries: LocalOnlyDelivery[];
    invocations: string[];
    disconnects: LocalOnlyDisconnect[];
    responseSendErrors: number;
    dispatchErrors: number;
    handshakeWaits: number;
    verdicts: number;
    earlierGuardFailures: number;
};

type GuardedService =
    | LocalOnlyGuardTargetService
    | LocalOnlyGuardChainTargetService;

type Delivery = {
    service: GuardedService;
    name: string;
    rpc: Rpc;
    transport: NetworkTransport;
    proven: boolean;
    negotiating: boolean;
    profile: PeerProfile | undefined;
};

type ActiveObservation = {
    deliveries: Delivery[];
    frames: { transport: NetworkTransport; response: RpcResponse }[];
    // Keys are the exact delivered calls; values count dispatcher response sends.
    responseAttempts: Map<Rpc, number>;
    disconnects: LocalOnlyDisconnect[];
    responseSendErrors: number;
    dispatchErrors: number;
    handshakeWaits: number;
    verdictsBefore: number;
    targetInvocationsBefore: number;
    chainInvocationsBefore: number;
    restore: () => void;
};

// Private dispatcher and transport members the observation wraps record-only.
type ResponsePath = {
    sendRpcResponseSafely(
        rpc: Rpc,
        response: RpcResponse,
        transport: NetworkTransport
    ): void;
};
type ClosingTransport = { afterClose(isExpected: boolean): void };

export class LocalOnlyGuardProbeService extends ANetworkRpcService<
    LocalOnlyGuardProbeRpcMethods,
    P2PManager<PingPongRpc>
> {
    private observation?: ActiveObservation;

    constructor(p2pManager: P2PManager<PingPongRpc>) {
        super(
            p2pManager.rpcRouter,
            p2pManager.stateManager.logger.child({
                component: "LocalOnlyGuardProbeService"
            })
        );
    }

    public createRPCMethods(
        transport: NetworkTransport
    ): LocalOnlyGuardProbeRpcMethods {
        return new LocalOnlyGuardProbeRpcMethods(transport, this);
    }

    /**
     * Record-only observation of the guarded services' dispatch, their
     * response path, the canonical disconnect owner, response frames on real
     * transports, dispatch and response-send error logs and the handshake
     * waiter. Every call is forwarded unchanged.
     */
    public startObservation(): void {
        if (this.observation) throw new Error("observation already active");
        const p2pManager = this.p2pManager;
        const services: [string, GuardedService][] = [
            ["localOnlyGuardTarget", p2pManager.localRpc.localOnlyGuardTarget],
            [
                "localOnlyGuardChainTarget",
                p2pManager.localRpc.localOnlyGuardChainTarget
            ]
        ];
        const observation: ActiveObservation = {
            deliveries: [],
            frames: [],
            responseAttempts: new Map(),
            disconnects: [],
            responseSendErrors: 0,
            dispatchErrors: 0,
            handshakeWaits: 0,
            verdictsBefore:
                p2pManager.stateManager.storage.blacklist.entries().length,
            targetInvocationsBefore:
                p2pManager.localRpc.localOnlyGuardTarget.invocations.length,
            chainInvocationsBefore:
                p2pManager.localRpc.localOnlyGuardChainTarget.invocations
                    .length,
            restore: () => undefined
        };
        const restores: (() => void)[] = [];
        let closing = 0;
        let responding = 0;

        // Only this receiver's own transports: the ones open now, any it
        // adds and any a guarded call arrives on while the observation runs. Each patch is an own property,
        // deleted on restore so the prototype method applies again.
        const patched = new Set<NetworkTransport>();
        const observeTransport = (transport: NetworkTransport) => {
            if (patched.has(transport)) return;
            patched.add(transport);
            const closingTransport = transport as unknown as ClosingTransport;
            const afterClose = closingTransport.afterClose;
            closingTransport.afterClose = function (isExpected) {
                closing += 1;
                try {
                    return afterClose.call(this, isExpected);
                } finally {
                    closing -= 1;
                }
            };
            const sendRpcResponse = transport.sendRpcResponse;
            transport.sendRpcResponse = function (response) {
                observation.frames.push({ transport: this, response });
                return sendRpcResponse.call(this, response);
            };
        };
        const init = p2pManager.localRpc.initHandshakeService;
        for (const [name, service] of services) {
            const runRPC = service.runRPC;
            service.runRPC = function (rpc, transport) {
                observeTransport(transport);
                observation.deliveries.push({
                    service,
                    name,
                    rpc,
                    transport,
                    proven: transport.peerAddress !== undefined,
                    negotiating: init.isNegotiating(transport),
                    profile:
                        p2pManager.profileManager.getProfileForFault(transport)
                });
                return runRPC.call(this, rpc, transport);
            };
            const responsePath = service as unknown as ResponsePath;
            const send = responsePath.sendRpcResponseSafely;
            responsePath.sendRpcResponseSafely = function (...args) {
                const [rpc] = args;
                observation.responseAttempts.set(
                    rpc,
                    (observation.responseAttempts.get(rpc) ?? 0) + 1
                );
                responding += 1;
                try {
                    return send.apply(this, args);
                } finally {
                    responding -= 1;
                }
            };
            const logger = service.logger;
            const error = logger.error;
            logger.error = function (message, ...meta) {
                if (message === "Failed to send RPC response")
                    observation.responseSendErrors += 1;
                return error.call(this, message, ...meta);
            };
            restores.push(() => {
                service.runRPC = runRPC;
                responsePath.sendRpcResponseSafely = send;
                logger.error = error;
            });
        }

        const disconnect = p2pManager.disconnectConnection;
        p2pManager.disconnectConnection = function (peer, policy, ...rest) {
            observation.disconnects.push({
                tier: DisconnectTier[policy.tier],
                reason: rest[0] ?? null,
                origin:
                    closing > 0
                        ? "close-bookkeeping"
                        : responding > 0
                          ? "response-failure"
                          : "direct"
            });
            return disconnect.call(this, peer, policy, ...rest);
        };

        for (const transport of p2pManager.openConnections)
            observeTransport(transport);
        const addConnection = p2pManager.addConnection;
        p2pManager.addConnection = function (transport) {
            observeTransport(transport);
            return addConnection.call(this, transport);
        };

        const routerLogger = p2pManager.logger;
        const routerError = routerLogger.error;
        routerLogger.error = function (message, ...meta) {
            if (message === "onRpc - error handling RPC frame")
                observation.dispatchErrors += 1;
            return routerError.call(this, message, ...meta);
        };

        const wait = init.waitForHandshakeCompleted;
        init.waitForHandshakeCompleted = function (...args) {
            observation.handshakeWaits += 1;
            return wait.apply(this, args);
        };

        observation.restore = () => {
            for (const restore of restores) restore();
            p2pManager.disconnectConnection = disconnect;
            p2pManager.addConnection = addConnection;
            for (const transport of patched) {
                Reflect.deleteProperty(transport, "afterClose");
                Reflect.deleteProperty(transport, "sendRpcResponse");
            }
            routerLogger.error = routerError;
            init.waitForHandshakeCompleted = wait;
        };
        this.observation = observation;
    }

    public readObservation(): LocalOnlyObservation {
        const observation = this.observation;
        if (!observation) throw new Error("no active observation");
        const localRpc = this.p2pManager.localRpc;
        return {
            deliveries: observation.deliveries.map((delivery) =>
                this.projectDelivery(observation, delivery)
            ),
            // Endpoint runs since the observation started.
            invocations: [
                ...localRpc.localOnlyGuardTarget.invocations.slice(
                    observation.targetInvocationsBefore
                ),
                ...localRpc.localOnlyGuardChainTarget.invocations.slice(
                    observation.chainInvocationsBefore
                )
            ],
            disconnects: [...observation.disconnects],
            responseSendErrors: observation.responseSendErrors,
            dispatchErrors: observation.dispatchErrors,
            handshakeWaits: observation.handshakeWaits,
            verdicts:
                this.p2pManager.stateManager.storage.blacklist.entries()
                    .length - observation.verdictsBefore,
            earlierGuardFailures:
                localRpc.localOnlyGuardChainTarget.earlier.failures
        };
    }

    public restoreObservation(): void {
        this.observation?.restore();
        this.observation = undefined;
    }

    /**
     * Send a local-only request over the transport this peer captured while
     * initiating a handshake, before that handshake completes. Returns how
     * the caller's request settled.
     */
    public async sendOverCapturedHandshakeTransport(
        value: string,
        timeoutMs: number
    ): Promise<string> {
        const transport =
            this.p2pManager.localRpc.stub.capturedInitHandshakeTransport;
        if (!transport) throw new Error("no captured handshake transport");
        try {
            await this.p2pManager.rpcRouter.sendRpcRequest(
                {
                    service: "localOnlyGuardTarget",
                    method: "record",
                    params: [value]
                },
                transport,
                { timeoutMs }
            );
            return "resolved";
        } catch (error) {
            return error instanceof Error ? error.message : String(error);
        }
    }

    /** Whether the captured pre-handshake transport has closed. */
    public isCapturedHandshakeTransportClosed(): boolean {
        const transport =
            this.p2pManager.localRpc.stub.capturedInitHandshakeTransport;
        if (!transport) throw new Error("no captured handshake transport");
        return transport.isClosed;
    }

    private projectDelivery(
        observation: ActiveObservation,
        delivery: Delivery
    ): LocalOnlyDelivery {
        const { rpc, transport } = delivery;
        const requestId = rpc.requestId;
        return {
            service: delivery.name,
            method: rpc.method,
            value: String(rpc.params?.[0]),
            request: requestId !== undefined,
            trusted: transport.isTrusted,
            proven: delivery.proven,
            negotiating: delivery.negotiating,
            profile: delivery.profile !== undefined,
            profileBlacklisted: delivery.profile?.isBlackListed ?? false,
            transportClosed: transport.isClosed,
            transportOpen: this.p2pManager.openConnections.includes(transport),
            localOnlySuppressed:
                delivery.service.localOnly.suppressesFailureResponse(rpc),
            responseAttempts: observation.responseAttempts.get(rpc) ?? 0,
            responseFrames:
                requestId === undefined
                    ? []
                    : observation.frames
                          .filter(
                              (frame) =>
                                  frame.response.requestId === requestId &&
                                  frame.transport === transport
                          )
                          .map((frame) => ({ ...frame.response }))
        };
    }
}
