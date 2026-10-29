import type ANetworkRpcMethods from "@/rpc/network/ANetworkRpcMethods";
import type ANetworkRpcService from "@/rpc/network/ANetworkRpcService";
import { AGuard } from "@/rpc/network/guards/AGuard";
import type Rpc from "@/rpc/Rpc";
import type NetworkTransport from "@/transport/NetworkTransport";

export interface DeferredAdmissionPolicy {
    isReady(rpc: Rpc, transport: NetworkTransport): boolean;
    canDefer(rpc: Rpc, transport: NetworkTransport): boolean;
    waitUntilReady(
        transport: NetworkTransport,
        timeoutMs: number
    ): Promise<boolean>;
    onRejected(rpc: Rpc, transport: NetworkTransport): void;
    onExpired(rpc: Rpc, transport: NetworkTransport): void;
}

type AdmissionQueue = {
    deferredRpcs: Rpc[];
    deferredRpcSet: WeakSet<Rpc>;
    waiting: boolean;
    unsubscribeDisconnected?: () => void;
    unsubscribeTransportClosed?: () => void;
};

export class DeferredAdmissionGuard extends AGuard<
    ANetworkRpcService<ANetworkRpcMethods>
> {
    private readonly queueByTransport = new WeakMap<
        NetworkTransport,
        AdmissionQueue
    >();

    constructor(
        service: ANetworkRpcService<ANetworkRpcMethods>,
        private readonly policy: DeferredAdmissionPolicy
    ) {
        super(service);
    }

    check(rpc: Rpc, transport: NetworkTransport): boolean {
        return this.policy.isReady(rpc, transport);
    }

    onFailure(rpc: Rpc, transport: NetworkTransport): void {
        if (!this.policy.canDefer(rpc, transport)) {
            this.policy.onRejected(rpc, transport);
            return;
        }

        const queue = this.getQueue(transport);
        queue.deferredRpcs.push(rpc);
        queue.deferredRpcSet.add(rpc);
        if (queue.waiting) return;
        queue.waiting = true;

        const timeoutMs =
            this.service.p2pManager.stateManager.timeConfig.agreementTime *
            2 *
            1000;
        void this.waitAndReplay(transport, queue, timeoutMs);
    }

    // Overrides AGuard.suppressesFailureResponse while admission is deferred.
    override suppressesFailureResponse(
        rpc: Rpc,
        transport: NetworkTransport
    ): boolean {
        return (
            this.queueByTransport.get(transport)?.deferredRpcSet.has(rpc) ??
            false
        );
    }

    clear(transport: NetworkTransport): void {
        const queue = this.queueByTransport.get(transport);
        if (!queue) return;
        queue.unsubscribeDisconnected?.();
        queue.unsubscribeTransportClosed?.();
        queue.deferredRpcs.length = 0;
        queue.waiting = false;
        this.queueByTransport.delete(transport);
    }

    private getQueue(transport: NetworkTransport): AdmissionQueue {
        const existing = this.queueByTransport.get(transport);
        if (existing) return existing;

        const queue: AdmissionQueue = {
            deferredRpcs: [],
            deferredRpcSet: new WeakSet(),
            waiting: false
        };
        const profile =
            this.service.p2pManager.profileManager.getProfileByTransport(
                transport
            );
        queue.unsubscribeDisconnected = profile?.onDisconnected(() => {
            const first = queue.deferredRpcs[0];
            this.clear(transport);
            if (first) this.policy.onExpired(first, transport);
        });
        queue.unsubscribeTransportClosed = transport.onClosed(() => {
            const first = queue.deferredRpcs[0];
            this.clear(transport);
            if (first) this.policy.onExpired(first, transport);
        });
        this.queueByTransport.set(transport, queue);
        return queue;
    }

    private async waitAndReplay(
        transport: NetworkTransport,
        queue: AdmissionQueue,
        timeoutMs: number
    ): Promise<void> {
        const ready = await this.policy.waitUntilReady(transport, timeoutMs);
        if (this.queueByTransport.get(transport) !== queue) return;

        const deferredRpcs = [...queue.deferredRpcs];
        this.clear(transport);
        if (
            ready &&
            !this.service.p2pManager.isDisposed &&
            !this.service.p2pManager.stateManager.isDisposed &&
            !transport.isClosed
        ) {
            // Start every admitted invocation in arrival order without serializing completion.
            await Promise.all(
                deferredRpcs.map((rpc) => this.service.runRPC(rpc, transport))
            );
            return;
        }

        if (deferredRpcs[0]) {
            this.policy.onExpired(deferredRpcs[0], transport);
        }
    }
}
