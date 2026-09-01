// @spec-test-coverage-ignore: worker-side support for HandshakeCompletedGuard component tests
import type P2PManager from "@/P2PManager";
import PeerProfile from "@/PeerProfile";
import ARpcMethods from "@/rpc/ARpcMethods";
import ARpcService from "@/rpc/ARpcService";
import {
    HandshakeCompletedGuard,
    type HandshakeCompletedGuardOptions
} from "@/rpc/guards/HandshakeCompletedGuard";
import {
    DeferredAdmissionGuard,
    type DeferredAdmissionPolicy
} from "@/rpc/guards/DeferredAdmissionGuard";
import type Rpc from "@/rpc/Rpc";
import type { RpcResponse } from "@/rpc/Rpc";
import ATransport from "@/transport/ATransport";
import { TransportType } from "@/transport/TransportType";
import { getChecksumAddress } from "@/utils";
import type { PingPongRpc } from "../PingPongRpcManifest";
import { HandshakeCompletedGuardProbeRpcMethods } from "./HandshakeCompletedGuardProbeRpcMethods";

class GuardTransport extends ATransport {
    public transportType = TransportType.HOLEPUNCH;
    public readonly responses: RpcResponse[] = [];
    public readonly fixtureAddress: string | undefined;
    public closeCalls = 0;
    public onSend?: (frame: string) => void;

    constructor(p2pManager: P2PManager<PingPongRpc>, fixtureAddress?: string) {
        super(p2pManager);
        this.fixtureAddress = fixtureAddress;
    }

    public _send(frame: string): void {
        const value = JSON.parse(frame) as Partial<RpcResponse>;
        if (value.rpcResponse === true) {
            this.responses.push(value as RpcResponse);
        }
        this.onSend?.(frame);
    }

    public onMessage(): void {}

    protected _close(): void {
        this.closeCalls += 1;
    }
}

type GuardTarget = {
    p2pManager: P2PManager<PingPongRpc>;
    invocations: string[];
};

class GuardTargetRpcMethods<
    TService extends GuardTarget = GuardTargetService
> extends ARpcMethods<P2PManager<PingPongRpc>> {
    constructor(
        transport: ATransport,
        private readonly service: TService
    ) {
        super(transport, service.p2pManager);
    }

    public record(value: string): string {
        this.service.invocations.push(value);
        return value;
    }
}

class GuardTargetService extends ARpcService<
    GuardTargetRpcMethods<GuardTargetService>,
    P2PManager<PingPongRpc>
> {
    public readonly invocations: string[] = [];

    constructor(
        p2pManager: P2PManager<PingPongRpc>,
        options?: HandshakeCompletedGuardOptions
    ) {
        super(
            p2pManager,
            p2pManager.stateManager.logger.child({
                component: "HandshakeCompletedGuardTarget"
            })
        );
        this.guards = [new HandshakeCompletedGuard(this, options)];
    }

    public createRPCMethods(
        transport: ATransport
    ): GuardTargetRpcMethods<GuardTargetService> {
        return new GuardTargetRpcMethods(transport, this);
    }
}

class ControlledAdmissionPolicy implements DeferredAdmissionPolicy {
    public ready = false;
    public eligible = true;
    public waitCalls = 0;
    public rejected = 0;
    public expired = 0;
    public readonly timeoutMs: number[] = [];
    public resolveWait?: (ready: boolean) => void;

    isReady(): boolean {
        return this.ready;
    }
    canDefer(): boolean {
        return this.eligible;
    }
    waitUntilReady(
        _transport: ATransport,
        timeoutMs: number
    ): Promise<boolean> {
        this.waitCalls += 1;
        this.timeoutMs.push(timeoutMs);
        return new Promise((resolve) => {
            this.resolveWait = resolve;
        });
    }
    onRejected(): void {
        this.rejected += 1;
    }
    onExpired(): void {
        this.expired += 1;
    }
}

class DeferredTargetService extends ARpcService<
    GuardTargetRpcMethods<DeferredTargetService>,
    P2PManager<PingPongRpc>
> {
    public readonly invocations: string[] = [];

    constructor(
        p2pManager: P2PManager<PingPongRpc>,
        policy: DeferredAdmissionPolicy
    ) {
        super(
            p2pManager,
            p2pManager.stateManager.logger.child({
                component: "DeferredAdmissionGuardTarget"
            })
        );
        this.guards = [new DeferredAdmissionGuard(this, policy)];
    }

    public createRPCMethods(
        transport: ATransport
    ): GuardTargetRpcMethods<DeferredTargetService> {
        return new GuardTargetRpcMethods(transport, this);
    }
}

export type CompletedGuardProbe = {
    consumed: boolean;
    invocations: string[];
};

export type QueueGuardProbe = {
    waitCalls: number;
    beforeCompletion: string[];
    afterCompletion: string[];
};

export type DeferredAdmissionProbe = {
    immediateInvocations: string[];
    beforeReplay: string[];
    afterReplay: string[];
    waitCalls: number;
    rejected: number;
    expired: number;
    transportCloseExpired: number;
    timeoutMs: number[];
    expectedTimeoutMs: number;
};

export type RequestGuardProbe = {
    immediateResponses: RpcResponse[];
    finalResponses: RpcResponse[];
    invocations: string[];
    callerError: string;
};

export type PunishmentGuardProbe = {
    blacklisted: boolean;
    disconnected: boolean;
    invocations: string[];
};

export type TimeoutGuardProbe = {
    waitCalls: number;
    timeoutMs: number[];
    expectedTimeoutMs: number;
    firstBlacklisted: boolean;
    firstDisconnected: boolean;
    invocations: string[];
};

export type QueueIsolationGuardProbe = {
    waitCalls: [number, number];
    afterFirstCompletion: string[];
    finalInvocations: string[];
    firstConnected: boolean;
    secondDisconnected: boolean;
};

export type AddresslessGuardProbe = {
    nonNegotiatingDisconnected: boolean;
    timeoutDisconnected: boolean;
    invocations: string[];
};

export type CustomFailureGuardProbe = {
    failureCalls: number;
    disconnected: boolean;
    invocations: string[];
};

export type RetiredTransportGuardProbe = {
    waitCalls: number;
    invocations: string[];
    retiredClosed: boolean;
    retiredRegistered: boolean;
    retiredBlacklisted: boolean;
    replacementCurrent: boolean;
};

export type DisposedWaiterGuardProbe = {
    invocations: string[];
    blacklisted: boolean;
    closeCalls: number;
    responses: RpcResponse[];
    managerDisposed: boolean;
};

export type LateCompletionGuardProbe = {
    waitCalls: number;
    invocations: string[];
    originalBlacklisted: boolean;
    originalDisconnected: boolean;
    replacementConnected: boolean;
};

export type GraceOverlapGuardProbe = {
    invocations: string[];
    originalClosed: boolean;
    replacementClosed: boolean;
    originalAuthenticated: boolean;
    replacementCurrent: boolean;
    profileBlacklisted: boolean;
    activeConnections: number;
};

export type ExactTransportQueueGuardProbe = {
    beforeAuthentication: string[];
    afterReplacementAuthentication: string[];
    finalInvocations: string[];
    originalAuthenticated: boolean;
    replacementAuthenticated: boolean;
    originalCurrent: boolean;
    profileBlacklisted: boolean;
};

export type ClosedTransportDispatchGuardProbe = {
    invocations: string[];
    originalClosed: boolean;
    replacementClosed: boolean;
    replacementConnected: boolean;
    profileBlacklisted: boolean;
};

export class HandshakeCompletedGuardProbeService extends ARpcService<
    HandshakeCompletedGuardProbeRpcMethods,
    P2PManager<PingPongRpc>
> {
    constructor(p2pManager: P2PManager<PingPongRpc>) {
        super(
            p2pManager,
            p2pManager.stateManager.logger.child({
                component: "HandshakeCompletedGuardProbeService"
            })
        );
    }

    public createRPCMethods(
        transport: ATransport
    ): HandshakeCompletedGuardProbeRpcMethods {
        return new HandshakeCompletedGuardProbeRpcMethods(transport, this);
    }

    private transport(address: string): GuardTransport {
        const transport = new GuardTransport(this.p2pManager, address);
        this.p2pManager.addConnection(transport);
        return transport;
    }

    private register(
        transport: GuardTransport,
        completed: boolean
    ): PeerProfile {
        const address = transport.fixtureAddress;
        if (!address) throw new Error("Fixture transport address is required");
        const profile = new PeerProfile(transport, address);
        if (completed) transport.peerAddress = address;
        this.p2pManager.profileManager.registerProfile(profile);
        return profile;
    }

    private completeProfile(profile: PeerProfile): void {
        const address = profile.getEvmAddress();
        const transport = profile.getTransport();
        if (!address || !transport)
            throw new Error("Fixture profile identity is required");
        transport.peerAddress = getChecksumAddress(address);
        this.p2pManager.profileManager.registerProfile(profile);
    }

    private prepareHandshake(transport: GuardTransport): void {
        const init = this.p2pManager.localRpc.initHandshakeService;
        const address = transport.fixtureAddress;
        if (!address) throw new Error("Fixture transport address is required");
        init.markHandshakeInFlight(transport);
        init.recordVerifiedPeerAddress(transport, address);
        init.markAcked(transport);
        init.setRemotePreferredTransport(transport, TransportType.HOLEPUNCH);
    }

    private async finalizeHandshake(transport: GuardTransport): Promise<void> {
        await this.p2pManager.localRpc.initHandshakeService.maybeFinalizeHandshakeOnceFromTransport(
            transport
        );
        await this.flush();
    }

    private rpc(value: string, requestId?: string): Rpc {
        return {
            service: "guardTarget",
            method: "record",
            params: [value],
            requestId
        };
    }

    private async flush(): Promise<void> {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }

    public async probeCompleted(): Promise<CompletedGuardProbe> {
        const transport = this.transport(
            "0xA000000000000000000000000000000000000001"
        );
        this.register(transport, true);
        const target = new GuardTargetService(this.p2pManager);
        const consumed = target.runRPC(this.rpc("completed"), transport);
        await this.flush();
        return { consumed, invocations: [...target.invocations] };
    }

    public async probeDeferredAdmission(): Promise<DeferredAdmissionProbe> {
        const transport = this.transport(
            "0xA000000000000000000000000000000000000020"
        );
        this.register(transport, true);
        const policy = new ControlledAdmissionPolicy();
        const target = new DeferredTargetService(this.p2pManager, policy);

        policy.ready = true;
        target.runRPC(this.rpc("immediate"), transport);
        await this.flush();
        const immediateInvocations = [...target.invocations];

        policy.ready = false;
        target.runRPC(this.rpc("first"), transport);
        target.runRPC(this.rpc("second"), transport);
        await this.flush();
        const beforeReplay = [...target.invocations];
        policy.ready = true;
        policy.resolveWait?.(true);
        await this.flush();
        const afterReplay = [...target.invocations];

        policy.ready = false;
        policy.eligible = false;
        target.runRPC(this.rpc("ineligible"), transport);
        policy.eligible = true;
        target.runRPC(this.rpc("expires"), transport);
        await this.flush();
        policy.resolveWait?.(false);
        await this.flush();

        const closeTransport = this.transport(
            "0xA000000000000000000000000000000000000021"
        );
        this.register(closeTransport, true);
        const closePolicy = new ControlledAdmissionPolicy();
        const closeTarget = new DeferredTargetService(
            this.p2pManager,
            closePolicy
        );
        closeTarget.runRPC(this.rpc("transport-close"), closeTransport);
        await this.flush();
        closeTransport.close();
        await this.flush();

        return {
            immediateInvocations,
            beforeReplay,
            afterReplay,
            waitCalls: policy.waitCalls,
            rejected: policy.rejected,
            expired: policy.expired,
            transportCloseExpired: closePolicy.expired,
            timeoutMs: policy.timeoutMs,
            expectedTimeoutMs:
                this.p2pManager.stateManager.timeConfig.agreementTime * 2 * 1000
        };
    }

    public async probeQueueReplay(): Promise<QueueGuardProbe> {
        const transport = this.transport(
            "0xA000000000000000000000000000000000000002"
        );
        const profile = this.register(transport, false);
        const target = new GuardTargetService(this.p2pManager);
        const init = this.p2pManager.localRpc.initHandshakeService;
        const originalIsNegotiating = init.isNegotiating.bind(init);
        const originalWait = init.waitForHandshakeCompleted.bind(init);
        let waitCalls = 0;
        let resolveWait: ((completed: boolean) => void) | undefined;
        init.isNegotiating = () => true;
        init.waitForHandshakeCompleted = async () => {
            waitCalls += 1;
            return await new Promise<boolean>((resolve) => {
                resolveWait = resolve;
            });
        };
        try {
            target.runRPC(this.rpc("first"), transport);
            target.runRPC(this.rpc("second"), transport);
            const beforeCompletion = [...target.invocations];
            this.completeProfile(profile);
            resolveWait?.(true);
            await this.flush();
            return {
                waitCalls,
                beforeCompletion,
                afterCompletion: [...target.invocations]
            };
        } finally {
            init.isNegotiating = originalIsNegotiating;
            init.waitForHandshakeCompleted = originalWait;
        }
    }

    public async probeRequestDuringNegotiation(): Promise<RequestGuardProbe> {
        const transport = this.transport(
            "0xA000000000000000000000000000000000000003"
        );
        const profile = this.register(transport, false);
        const target = new GuardTargetService(this.p2pManager);
        const init = this.p2pManager.localRpc.initHandshakeService;
        const originalIsNegotiating = init.isNegotiating.bind(init);
        const originalWait = init.waitForHandshakeCompleted.bind(init);
        let resolveWait: ((completed: boolean) => void) | undefined;
        init.isNegotiating = () => true;
        init.waitForHandshakeCompleted = async () =>
            await new Promise<boolean>((resolve) => {
                resolveWait = resolve;
            });
        try {
            transport.onSend = (frame) => {
                const value = JSON.parse(frame) as Rpc | RpcResponse;
                if ("rpcResponse" in value) {
                    this.p2pManager.onRpc(frame, transport);
                    return;
                }
                target.runRPC(value, transport);
            };
            const caller = this.p2pManager.sendRpcRequest<string>(
                this.rpc("request"),
                transport,
                { timeoutMs: 1_000 }
            );
            const callerOutcome = caller.then(
                () => "resolved",
                (error: unknown) =>
                    error instanceof Error ? error.message : String(error)
            );
            await this.flush();
            const immediateResponses = [...transport.responses];
            this.completeProfile(profile);
            resolveWait?.(true);
            await this.flush();
            const callerError = await callerOutcome;
            return {
                immediateResponses,
                finalResponses: [...transport.responses],
                invocations: [...target.invocations],
                callerError
            };
        } finally {
            transport.onSend = undefined;
            init.isNegotiating = originalIsNegotiating;
            init.waitForHandshakeCompleted = originalWait;
        }
    }

    public async probeNonNegotiatingPunishment(): Promise<PunishmentGuardProbe> {
        const transport = this.transport(
            "0xA000000000000000000000000000000000000004"
        );
        const profile = this.register(transport, false);
        const target = new GuardTargetService(this.p2pManager);
        target.runRPC(this.rpc("blocked"), transport);
        await this.flush();
        return {
            blacklisted: profile.isBlackListed,
            disconnected: !this.p2pManager.openConnections.includes(transport),
            invocations: [...target.invocations]
        };
    }

    public async probeTimeoutAndFreshWaiter(): Promise<TimeoutGuardProbe> {
        const transport = this.transport(
            "0xA000000000000000000000000000000000000005"
        );
        const profile = this.register(transport, false);
        const target = new GuardTargetService(this.p2pManager);
        const init = this.p2pManager.localRpc.initHandshakeService;
        const originalIsNegotiating = init.isNegotiating.bind(init);
        const originalWait = init.waitForHandshakeCompleted.bind(init);
        let waitCalls = 0;
        const timeoutMs: number[] = [];
        const resolvers: ((completed: boolean) => void)[] = [];
        init.isNegotiating = () => true;
        init.waitForHandshakeCompleted = async (_transport, timeout) => {
            waitCalls += 1;
            timeoutMs.push(timeout);
            return await new Promise<boolean>((resolve) => {
                resolvers.push(resolve);
            });
        };
        try {
            target.runRPC(this.rpc("timed-out"), transport);
            resolvers[0](false);
            await this.flush();
            const firstBlacklisted = profile.isBlackListed;
            const firstDisconnected =
                !this.p2pManager.openConnections.includes(transport);

            const freshTransport = this.transport(
                "0xA000000000000000000000000000000000000005"
            );
            const freshProfile = this.register(freshTransport, false);
            target.runRPC(this.rpc("fresh"), freshTransport);
            await this.flush();
            this.completeProfile(freshProfile);
            resolvers[1](true);
            await this.flush();
            return {
                waitCalls,
                timeoutMs,
                expectedTimeoutMs:
                    this.p2pManager.stateManager.timeConfig.agreementTime *
                    2 *
                    1000,
                firstBlacklisted,
                firstDisconnected,
                invocations: [...target.invocations]
            };
        } finally {
            init.isNegotiating = originalIsNegotiating;
            init.waitForHandshakeCompleted = originalWait;
        }
    }

    public async probeQueueIsolation(): Promise<QueueIsolationGuardProbe> {
        const first = this.transport(
            "0xA000000000000000000000000000000000000006"
        );
        const second = this.transport(
            "0xA000000000000000000000000000000000000007"
        );
        const firstProfile = this.register(first, false);
        this.register(second, false);
        const target = new GuardTargetService(this.p2pManager);
        const init = this.p2pManager.localRpc.initHandshakeService;
        const originalIsNegotiating = init.isNegotiating.bind(init);
        const originalWait = init.waitForHandshakeCompleted.bind(init);
        const waitCalls = new Map<ATransport, number>();
        const resolvers = new Map<ATransport, (completed: boolean) => void>();
        init.isNegotiating = () => true;
        init.waitForHandshakeCompleted = async (transport) => {
            waitCalls.set(transport, (waitCalls.get(transport) ?? 0) + 1);
            return await new Promise<boolean>((resolve) => {
                resolvers.set(transport, resolve);
            });
        };
        try {
            target.runRPC(this.rpc("first-transport"), first);
            target.runRPC(this.rpc("second-transport"), second);
            this.completeProfile(firstProfile);
            resolvers.get(first)?.(true);
            await this.flush();
            const afterFirstCompletion = [...target.invocations];
            resolvers.get(second)?.(false);
            await this.flush();
            return {
                waitCalls: [
                    waitCalls.get(first) ?? 0,
                    waitCalls.get(second) ?? 0
                ],
                afterFirstCompletion,
                finalInvocations: [...target.invocations],
                firstConnected: this.p2pManager.openConnections.includes(first),
                secondDisconnected:
                    !this.p2pManager.openConnections.includes(second)
            };
        } finally {
            init.isNegotiating = originalIsNegotiating;
            init.waitForHandshakeCompleted = originalWait;
        }
    }

    public async probeAddresslessFallback(): Promise<AddresslessGuardProbe> {
        const nonNegotiating = new GuardTransport(this.p2pManager);
        this.p2pManager.addConnection(nonNegotiating);
        const nonNegotiatingTarget = new GuardTargetService(this.p2pManager);
        nonNegotiatingTarget.runRPC(
            this.rpc("non-negotiating"),
            nonNegotiating
        );
        await this.flush();

        const timedOut = new GuardTransport(this.p2pManager);
        this.p2pManager.addConnection(timedOut);
        const timeoutTarget = new GuardTargetService(this.p2pManager);
        const init = this.p2pManager.localRpc.initHandshakeService;
        const originalIsNegotiating = init.isNegotiating.bind(init);
        const originalWait = init.waitForHandshakeCompleted.bind(init);
        init.isNegotiating = (transport) => transport === timedOut;
        init.waitForHandshakeCompleted = async () => false;
        try {
            timeoutTarget.runRPC(this.rpc("timeout"), timedOut);
            await this.flush();
            return {
                nonNegotiatingDisconnected:
                    !this.p2pManager.openConnections.includes(nonNegotiating),
                timeoutDisconnected:
                    !this.p2pManager.openConnections.includes(timedOut),
                invocations: [
                    ...nonNegotiatingTarget.invocations,
                    ...timeoutTarget.invocations
                ]
            };
        } finally {
            init.isNegotiating = originalIsNegotiating;
            init.waitForHandshakeCompleted = originalWait;
        }
    }

    public async probeCustomFailure(): Promise<CustomFailureGuardProbe> {
        const transport = this.transport(
            "0xA000000000000000000000000000000000000008"
        );
        let failureCalls = 0;
        const target = new GuardTargetService(this.p2pManager, {
            onFailure: () => {
                failureCalls += 1;
            }
        });
        target.runRPC(this.rpc("custom"), transport);
        await this.flush();
        return {
            failureCalls,
            disconnected: !this.p2pManager.openConnections.includes(transport),
            invocations: [...target.invocations]
        };
    }

    public async probeRetiredTransportCompletion(): Promise<RetiredTransportGuardProbe> {
        const address = "0xA000000000000000000000000000000000000009";
        const retired = this.transport(address);
        const retiredProfile = this.register(retired, false);
        const target = new GuardTargetService(this.p2pManager);
        const init = this.p2pManager.localRpc.initHandshakeService;
        const originalIsNegotiating = init.isNegotiating.bind(init);
        const originalWait = init.waitForHandshakeCompleted.bind(init);
        let waitCalls = 0;
        let resolveWait: ((completed: boolean) => void) | undefined;
        init.isNegotiating = () => true;
        init.waitForHandshakeCompleted = async () => {
            waitCalls += 1;
            return await new Promise<boolean>((resolve) => {
                resolveWait = resolve;
            });
        };
        try {
            target.runRPC(this.rpc("retired-first"), retired);
            target.runRPC(this.rpc("retired-second"), retired);
            retired.close();
            this.p2pManager.profileManager.unregisterProfile(
                retiredProfile,
                retired
            );

            const replacement = this.transport(address);
            const replacementProfile = this.register(replacement, true);
            target.runRPC(this.rpc("replacement"), replacement);

            retired.peerAddress = address;
            resolveWait?.(true);
            await this.flush();

            return {
                waitCalls,
                invocations: [...target.invocations],
                retiredClosed: retired.isClosed,
                retiredRegistered:
                    this.p2pManager.profileManager.getProfileByTransport(
                        retired
                    ) !== undefined,
                retiredBlacklisted: retiredProfile.isBlackListed,
                replacementCurrent:
                    replacementProfile.getTransport() === replacement
            };
        } finally {
            init.isNegotiating = originalIsNegotiating;
            init.waitForHandshakeCompleted = originalWait;
        }
    }

    public async probeDisposedWaiter(
        completed: boolean
    ): Promise<DisposedWaiterGuardProbe> {
        const transport = this.transport(
            "0xA000000000000000000000000000000000000010"
        );
        const profile = this.register(transport, false);
        const target = new GuardTargetService(this.p2pManager);
        const init = this.p2pManager.localRpc.initHandshakeService;
        const originalIsNegotiating = init.isNegotiating.bind(init);
        const originalWait = init.waitForHandshakeCompleted.bind(init);
        let resolveWait: ((value: boolean) => void) | undefined;
        init.isNegotiating = () => true;
        init.waitForHandshakeCompleted = async () =>
            await new Promise<boolean>((resolve) => {
                resolveWait = resolve;
            });
        try {
            target.runRPC(this.rpc("disposed-first"), transport);
            target.runRPC(this.rpc("disposed-second"), transport);
            await this.p2pManager.dispose();
            if (completed) {
                const address = profile.getEvmAddress();
                if (!address)
                    throw new Error("Fixture profile identity is required");
                transport.peerAddress = getChecksumAddress(address);
            }
            resolveWait?.(completed);
            await this.flush();
            return {
                invocations: [...target.invocations],
                blacklisted: profile.isBlackListed,
                closeCalls: transport.closeCalls,
                responses: [...transport.responses],
                managerDisposed: this.p2pManager.isDisposed
            };
        } finally {
            init.isNegotiating = originalIsNegotiating;
            init.waitForHandshakeCompleted = originalWait;
        }
    }

    public async probeLateCompletionAfterTimeout(): Promise<LateCompletionGuardProbe> {
        const address = "0xA000000000000000000000000000000000000011";
        const original = this.transport(address);
        const originalProfile = this.register(original, false);
        const target = new GuardTargetService(this.p2pManager);
        const init = this.p2pManager.localRpc.initHandshakeService;
        const originalIsNegotiating = init.isNegotiating.bind(init);
        const originalWait = init.waitForHandshakeCompleted.bind(init);
        let waitCalls = 0;
        const resolvers: ((completed: boolean) => void)[] = [];
        init.isNegotiating = () => true;
        init.waitForHandshakeCompleted = async () => {
            waitCalls += 1;
            return await new Promise<boolean>((resolve) => {
                resolvers.push(resolve);
            });
        };
        try {
            target.runRPC(this.rpc("timed-out"), original);
            resolvers[0](false);
            await this.flush();

            original.peerAddress = address;
            await this.flush();

            const replacement = this.transport(address);
            const replacementProfile = this.register(replacement, false);
            target.runRPC(this.rpc("replacement"), replacement);
            this.completeProfile(replacementProfile);
            resolvers[1](true);
            await this.flush();

            return {
                waitCalls,
                invocations: [...target.invocations],
                originalBlacklisted: originalProfile.isBlackListed,
                originalDisconnected:
                    !this.p2pManager.openConnections.includes(original),
                replacementConnected:
                    this.p2pManager.openConnections.includes(replacement)
            };
        } finally {
            init.isNegotiating = originalIsNegotiating;
            init.waitForHandshakeCompleted = originalWait;
        }
    }

    public async probeAuthenticatedGraceOverlap(): Promise<GraceOverlapGuardProbe> {
        const address = "0xA000000000000000000000000000000000000012";
        const original = this.transport(address);
        const profile = this.register(original, true);
        const replacement = this.transport(address);
        this.p2pManager.profileManager.authenticateTransport(
            replacement,
            address
        );
        const target = new GuardTargetService(this.p2pManager);

        target.runRPC(this.rpc("original-live"), original);
        await this.flush();

        return {
            invocations: [...target.invocations],
            originalClosed: original.isClosed,
            replacementClosed: replacement.isClosed,
            originalAuthenticated: original.peerAddress !== undefined,
            replacementCurrent: profile.getTransport() === replacement,
            profileBlacklisted: profile.isBlackListed,
            activeConnections: this.p2pManager.openConnections.length
        };
    }

    public async probeExactTransportQueueOwnership(): Promise<ExactTransportQueueGuardProbe> {
        const address = "0xA000000000000000000000000000000000000013";
        const original = this.transport(address);
        const profile = this.register(original, false);
        const target = new GuardTargetService(this.p2pManager);
        this.prepareHandshake(original);

        target.runRPC(this.rpc("original-first"), original);
        target.runRPC(this.rpc("original-second"), original);
        const beforeAuthentication = [...target.invocations];

        const replacement = this.transport(address);
        this.prepareHandshake(replacement);
        await this.finalizeHandshake(replacement);
        const afterReplacementAuthentication = [...target.invocations];

        await this.finalizeHandshake(original);

        return {
            beforeAuthentication,
            afterReplacementAuthentication,
            finalInvocations: [...target.invocations],
            originalAuthenticated: original.peerAddress !== undefined,
            replacementAuthenticated: replacement.peerAddress !== undefined,
            originalCurrent: profile.getTransport() === original,
            profileBlacklisted: profile.isBlackListed
        };
    }

    public async probeClosedTransportDispatch(): Promise<ClosedTransportDispatchGuardProbe> {
        const address = "0xA000000000000000000000000000000000000014";
        const original = this.transport(address);
        const profile = this.register(original, true);
        const replacement = this.transport(address);
        this.p2pManager.profileManager.authenticateTransport(
            replacement,
            address
        );
        const target = new GuardTargetService(this.p2pManager);

        original.close(true);
        target.runRPC(this.rpc("late-closed-frame"), original);
        await this.flush();

        return {
            invocations: [...target.invocations],
            originalClosed: original.isClosed,
            replacementClosed: replacement.isClosed,
            replacementConnected:
                this.p2pManager.openConnections.includes(replacement),
            profileBlacklisted: profile.isBlackListed
        };
    }
}
