import type { AInternalRpcRoot } from "@/rpc/internal/AInternalRpcRoot";
import type { RemoteRoot } from "@/rpc/internal/RemoteRoot";
import type { RpcRequestId } from "@/rpc/router/ARpcRouter";
// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import type Rpc from "@/rpc/Rpc";
import { isRpc, isRpcResponse } from "@/rpc/Rpc";
import type InternalTransport from "@/transport/InternalTransport";

/** Holds and observes actual deliveries; the production router still settles every request. */
export class RuntimeRpcControl {
    private static readonly installed = new WeakMap<
        InternalTransport,
        RuntimeRpcControl
    >();
    public readonly sent: Array<
        Pick<Rpc, "service" | "method" | "requestId" | "params">
    > = [];
    public readonly events: Array<{
        direction: "send" | "receive" | "close";
        method?: string;
        requestId?: string;
        response?: boolean;
        timed?: boolean;
    }> = [];
    private readonly restore: () => void;
    private readonly held: Array<() => void> = [];
    private holdMethod?: string;
    private holdIncomingMethod?: string;
    private failMethod?: string;
    private corruptParamsMethod?: string;
    private heldRequestId?: string;
    private received?: () => void;

    private constructor(private readonly transport: InternalTransport) {
        const send = transport.send.bind(transport);
        const receive = transport.onMessage.bind(transport);
        transport.send = (rpc: Rpc, transfer?: unknown[]) => {
            if (rpc.method === this.corruptParamsMethod) {
                this.corruptParamsMethod = undefined;
                Reflect.set(rpc, "params", null);
            }
            this.sent.push({
                service: rpc.service,
                params: rpc.params,
                method: rpc.method,
                requestId: rpc.requestId
            });
            this.events.push({
                direction: "send",
                method: rpc.method,
                requestId: rpc.requestId,
                timed: this.hasRequestTimer(rpc.requestId)
            });
            if (
                rpc.method === this.holdMethod &&
                this.heldRequestId === undefined
            )
                this.heldRequestId = rpc.requestId;
            if (rpc.method === this.failMethod) {
                this.failMethod = undefined;
                send(rpc, [{}]);
            } else send(rpc, transfer);
        };
        transport.onMessage = (frame: unknown) => {
            if (isRpc(frame) || isRpcResponse(frame))
                this.events.push({
                    direction: "receive",
                    method: isRpc(frame) ? frame.method : undefined,
                    requestId: frame.requestId,
                    response: isRpcResponse(frame)
                });
            if (
                (isRpcResponse(frame) &&
                    frame.requestId === this.heldRequestId) ||
                (isRpc(frame) && frame.method === this.holdIncomingMethod)
            ) {
                this.held.push(() => receive(frame));
                this.received?.();
                return;
            }
            receive(frame);
        };
        this.restore = () => {
            transport.send = send;
            transport.onMessage = receive;
        };
        transport.onClosed(() => {
            this.events.push({ direction: "close" });
            this.dispose();
        });
    }

    public static attachTo(
        remoteRoot: RemoteRoot<AInternalRpcRoot>
    ): RuntimeRpcControl {
        return this.attach(remoteRoot["transport"]);
    }

    public static attach(transport: InternalTransport): RuntimeRpcControl {
        const existing = this.installed.get(transport);
        if (existing) return existing;
        const control = new RuntimeRpcControl(transport);
        this.installed.set(transport, control);
        return control;
    }

    public static get(
        transport: InternalTransport
    ): RuntimeRpcControl | undefined {
        return this.installed.get(transport);
    }

    public failNextPost(method: string): void {
        this.failMethod = method;
    }
    public corruptNextParams(method: string): void {
        this.corruptParamsMethod = method;
    }

    public holdNextMessage(method: string): Promise<void> {
        this.holdIncomingMethod = method;
        return new Promise((resolve) => {
            this.received = resolve;
        });
    }

    public holdNextResponse(method: string): Promise<void> {
        this.holdMethod = method;
        this.heldRequestId = undefined;
        return new Promise((resolve) => {
            this.received = resolve;
        });
    }

    public releaseAt(index: number): void {
        const [deliver] = this.held.splice(index, 1);
        if (!deliver)
            throw new Error("No held delivery at the requested index");
        deliver();
    }

    public get heldCount(): number {
        return this.held.length;
    }

    private hasRequestTimer(requestId?: RpcRequestId): boolean {
        // Request IDs map to the real router-owned pending entries.
        const pending = Reflect.get(
            this.transport.router,
            "pendingRpcRequests"
        ) as Map<RpcRequestId, { timeout?: ReturnType<typeof setTimeout> }>;
        return (
            requestId !== undefined &&
            pending.get(requestId)?.timeout !== undefined
        );
    }

    public pendingTimers(): number {
        // Observe the real owner's private timer slots; the fixture never schedules or settles requests.
        // Request IDs map to the real router-owned pending entries.
        const pending = Reflect.get(
            this.transport.router,
            "pendingRpcRequests"
        ) as Map<
            string,
            {
                transport: InternalTransport;
                timeout?: ReturnType<typeof setTimeout>;
            }
        >;
        return [...pending.values()].filter(
            (entry) =>
                entry.transport === this.transport &&
                entry.timeout !== undefined
        ).length;
    }

    public release(): void {
        this.holdIncomingMethod = undefined;
        this.holdMethod = undefined;
        this.heldRequestId = undefined;
        for (const deliver of this.held.splice(0)) deliver();
    }

    public dispose(): void {
        this.restore();
        this.held.length = 0;
        RuntimeRpcControl.installed.delete(this.transport);
    }
}
