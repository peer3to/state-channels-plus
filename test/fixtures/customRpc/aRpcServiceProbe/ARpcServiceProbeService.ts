// @spec-test-coverage-ignore: host-side support service for ARpcService component tests
import type P2PManager from "@/P2PManager";
import ARpcMethods from "@/rpc/ARpcMethods";
import ARpcService from "@/rpc/ARpcService";
import type Rpc from "@/rpc/Rpc";
import type { RpcResponse } from "@/rpc/Rpc";
import { AGuard } from "@/rpc/guards/AGuard";
import ATransport from "@/transport/ATransport";
import { TransportType } from "@/transport/TransportType";
import type { PingPongRpc } from "../PingPongRpcManifest";
import { ARpcServiceProbeRpcMethods } from "./ARpcServiceProbeRpcMethods";

export type ARpcDispatchProbe = {
    consumed: boolean;
    invocations: string[];
    accessorReads: number;
    guardChecks: number;
    guardFailures: number;
    methodConstructions: number;
    disconnectCalls: number;
    responseSendAttempts: number;
    thisMatchesMethodsInstance: boolean;
    unhandledRejections: string[];
    responses: RpcResponse[];
};

export type ARpcDispatchProbeOptions = {
    requestId?: string;
    trusted: boolean;
    guardPasses: boolean;
    guarded: boolean;
    withoutRpcMethodsPrototype: boolean;
    responseSendThrows: boolean;
    shadowMode?: "accessor" | "nonFunction";
    params: Rpc["params"];
};

class ProbeTransport extends ATransport {
    public transportType = TransportType.HOLEPUNCH;
    public readonly serializedFrames: string[] = [];
    public responseSendAttempts = 0;
    private readonly trusted: boolean;
    private readonly responseSendThrows: boolean;

    constructor(
        p2pManager: P2PManager,
        trusted: boolean,
        responseSendThrows: boolean
    ) {
        super(p2pManager);
        this.trusted = trusted;
        this.responseSendThrows = responseSendThrows;
    }

    public get isTrusted(): boolean {
        return this.trusted;
    }

    public _send(serializedRPC: string): void {
        this.responseSendAttempts += 1;
        if (this.responseSendThrows) throw new Error("response send failed");
        this.serializedFrames.push(serializedRPC);
    }

    public onMessage(): void {}

    protected _close(): void {}
}

class ProbeGuard extends AGuard<ProbeTargetService> {
    public check(): boolean {
        this.service.guardChecks += 1;
        return this.service.guardPasses;
    }

    public onFailure(): void {
        this.service.guardFailures += 1;
    }
}

class ParentProbeRpcMethods extends ARpcMethods<P2PManager<PingPongRpc>> {
    protected readonly service: ProbeTargetService;

    constructor(transport: ATransport, service: ProbeTargetService) {
        super(transport, service.p2pManager);
        this.service = service;
    }

    public parentEndpoint(): string {
        this.service.recordInvocation("parentEndpoint");
        return "parent-result";
    }

    public shadowedEndpoint(): string {
        this.service.recordInvocation("inherited-shadowed-endpoint");
        return "inherited-shadowed-result";
    }
}

class ProbeTargetRpcMethods extends ParentProbeRpcMethods {
    public ownEndpoint = (): string => {
        this.service.recordInvocation("ownEndpoint");
        return "own-result";
    };
    public captureEndpoint = (): string => {
        this.service.recordInvocation("captured-original");
        return "captured-original-result";
    };
    public nonFunction = "not-an-endpoint";

    public get accessorEndpoint(): () => string {
        this.service.accessorReads += 1;
        return () => "accessor-result";
    }

    public childEndpoint(): string {
        this.service.recordInvocation("childEndpoint");
        return "child-result";
    }

    public requestThrows(): string {
        throw new Error("request endpoint failed");
    }

    public oneWayThrows(): void {
        throw new Error("one-way endpoint failed synchronously");
    }

    public paramsAndThis(first: string, second: number): string {
        this.service.recordMethodsThis(this);
        return `${first}:${second}`;
    }

    public async oneWayRejects(): Promise<void> {
        throw new Error("one-way endpoint failed");
    }
}

class ProbeTargetService extends ARpcService<
    ProbeTargetRpcMethods,
    P2PManager<PingPongRpc>
> {
    public accessorReads = 0;
    public guardChecks = 0;
    public guardFailures = 0;
    public methodConstructions = 0;
    public guardPasses = true;
    public invocations: string[] = [];
    public withoutRpcMethodsPrototype = false;
    public shadowMode?: "accessor" | "nonFunction";
    public thisMatchesMethodsInstance = false;
    private readonly guard: ProbeGuard;
    private currentMethods?: ProbeTargetRpcMethods;

    constructor(p2pManager: P2PManager<PingPongRpc>) {
        super(
            p2pManager,
            p2pManager.stateManager.logger.child({
                component: "ProbeTargetService"
            })
        );
        this.guard = new ProbeGuard(this);
        this.guards = [this.guard];
    }

    public createRPCMethods(transport: ATransport): ProbeTargetRpcMethods {
        this.methodConstructions += 1;
        const methods = new ProbeTargetRpcMethods(transport, this);
        if (this.shadowMode === "accessor") {
            Object.defineProperty(methods, "shadowedEndpoint", {
                configurable: true,
                get: () => {
                    this.accessorReads += 1;
                    return () => "shadow-accessor-result";
                }
            });
        } else if (this.shadowMode === "nonFunction") {
            Object.defineProperty(methods, "shadowedEndpoint", {
                configurable: true,
                value: "shadow-non-function"
            });
        }
        if (this.withoutRpcMethodsPrototype) {
            Object.setPrototypeOf(methods, Object.prototype);
        }
        const service = this;
        let captureDescriptorRead = false;
        const proxiedMethods = new Proxy(methods, {
            getOwnPropertyDescriptor(target, property) {
                const descriptor = Reflect.getOwnPropertyDescriptor(
                    target,
                    property
                );
                if (
                    property === "captureEndpoint" &&
                    descriptor &&
                    !captureDescriptorRead
                ) {
                    captureDescriptorRead = true;
                    target.captureEndpoint = (): string => {
                        service.recordInvocation("captured-replacement");
                        return "captured-replacement-result";
                    };
                }
                return descriptor;
            }
        });
        this.currentMethods = proxiedMethods;
        return proxiedMethods;
    }

    public recordInvocation(methodName: string): void {
        this.invocations.push(methodName);
    }

    public recordMethodsThis(methods: ProbeTargetRpcMethods): void {
        this.thisMatchesMethodsInstance = methods === this.currentMethods;
    }

    public reset(
        guardPasses: boolean,
        guarded: boolean,
        withoutRpcMethodsPrototype: boolean,
        shadowMode?: "accessor" | "nonFunction"
    ): void {
        this.accessorReads = 0;
        this.guardChecks = 0;
        this.guardFailures = 0;
        this.methodConstructions = 0;
        this.guardPasses = guardPasses;
        this.invocations = [];
        this.guards = guarded ? [this.guard] : [];
        this.withoutRpcMethodsPrototype = withoutRpcMethodsPrototype;
        this.shadowMode = shadowMode;
        this.thisMatchesMethodsInstance = false;
        this.currentMethods = undefined;
    }
}

export class ARpcServiceProbeService extends ARpcService<
    ARpcServiceProbeRpcMethods,
    P2PManager<PingPongRpc>
> {
    private readonly targetService: ProbeTargetService;

    constructor(p2pManager: P2PManager<PingPongRpc>) {
        super(
            p2pManager,
            p2pManager.stateManager.logger.child({
                component: "ARpcServiceProbeService"
            })
        );
        this.targetService = new ProbeTargetService(p2pManager);
    }

    public createRPCMethods(transport: ATransport): ARpcServiceProbeRpcMethods {
        return new ARpcServiceProbeRpcMethods(transport, this);
    }

    public async probeDispatch(
        method: string,
        options: ARpcDispatchProbeOptions
    ): Promise<ARpcDispatchProbe> {
        this.targetService.reset(
            options.guardPasses,
            options.guarded,
            options.withoutRpcMethodsPrototype,
            options.shadowMode
        );
        const transport = new ProbeTransport(
            this.p2pManager,
            options.trusted,
            options.responseSendThrows
        );
        let disconnectCalls = 0;
        const unhandledRejections: string[] = [];
        const onUnhandledRejection = (reason: unknown): void => {
            unhandledRejections.push(
                reason instanceof Error ? reason.message : String(reason)
            );
        };
        const originalDisconnect = this.p2pManager.disconnectConnection.bind(
            this.p2pManager
        );
        this.p2pManager.disconnectConnection = (): void => {
            disconnectCalls += 1;
        };

        let consumed: boolean;
        process.on("unhandledRejection", onUnhandledRejection);
        try {
            const rpc: Rpc = {
                service: "probeTarget",
                method,
                params: options.params,
                requestId: options.requestId
            };
            consumed = this.targetService.runRPC(rpc, transport);
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
        } finally {
            process.off("unhandledRejection", onUnhandledRejection);
            this.p2pManager.disconnectConnection = originalDisconnect;
        }

        return {
            consumed,
            invocations: [...this.targetService.invocations],
            accessorReads: this.targetService.accessorReads,
            guardChecks: this.targetService.guardChecks,
            guardFailures: this.targetService.guardFailures,
            methodConstructions: this.targetService.methodConstructions,
            disconnectCalls,
            responseSendAttempts: transport.responseSendAttempts,
            thisMatchesMethodsInstance:
                this.targetService.thisMatchesMethodsInstance,
            unhandledRejections,
            responses: transport.serializedFrames.map(
                (frame) => JSON.parse(frame) as RpcResponse
            )
        };
    }
}
