// @spec-test-coverage-ignore: worker-side support for HandshakeCompletedGuard component tests
import type P2PManager from "@/P2PManager";
import PeerProfile from "@/PeerProfile";
import ARpcMethods from "@/rpc/ARpcMethods";
import ARpcService from "@/rpc/ARpcService";
import {
    HandshakeCompletedGuard,
    type HandshakeCompletedGuardOptions
} from "@/rpc/guards/HandshakeCompletedGuard";
import type Rpc from "@/rpc/Rpc";
import type { RpcResponse } from "@/rpc/Rpc";
import ATransport from "@/transport/ATransport";
import { TransportType } from "@/transport/TransportType";
import type { PingPongRpc } from "../PingPongRpcManifest";
import { HandshakeCompletedGuardProbeRpcMethods } from "./HandshakeCompletedGuardProbeRpcMethods";

class GuardTransport extends ATransport {
    public transportType = TransportType.HOLEPUNCH;
    public readonly responses: RpcResponse[] = [];
    public closeCalls = 0;
    public onSend?: (frame: string) => void;

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

class GuardTargetRpcMethods extends ARpcMethods<P2PManager<PingPongRpc>> {
    constructor(
        transport: ATransport,
        private readonly service: GuardTargetService
    ) {
        super(transport, service.p2pManager);
    }

    public record(value: string): string {
        this.service.invocations.push(value);
        return value;
    }
}

class GuardTargetService extends ARpcService<
    GuardTargetRpcMethods,
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

    public createRPCMethods(transport: ATransport): GuardTargetRpcMethods {
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
        const transport = new GuardTransport(this.p2pManager);
        transport.peerAddress = address;
        this.p2pManager.addConnection(transport);
        return transport;
    }

    private register(
        transport: GuardTransport,
        completed: boolean
    ): PeerProfile {
        const profile = new PeerProfile(transport, transport.peerAddress!);
        profile.setIsHandshakeCompleted(completed);
        this.p2pManager.profileManager.registerProfile(profile);
        return profile;
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
            profile.setIsHandshakeCompleted(true);
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
            const callerError = await caller.then(
                () => "resolved",
                (error: unknown) =>
                    error instanceof Error ? error.message : String(error)
            );
            const immediateResponses = [...transport.responses];
            profile.setIsHandshakeCompleted(true);
            resolveWait?.(true);
            await this.flush();
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
            freshProfile.setIsHandshakeCompleted(true);
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
            firstProfile.setIsHandshakeCompleted(true);
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
}
