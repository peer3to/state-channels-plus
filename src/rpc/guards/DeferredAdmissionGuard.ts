import type Rpc from "@/rpc/Rpc";
import type ATransport from "@/transport/ATransport";
import { AGuard } from "@/rpc/guards/AGuard";
import type ARpcService from "@/rpc/ARpcService";
import type ARpcMethods from "@/rpc/ARpcMethods";

export interface DeferredAdmissionPolicy {
    isReady(rpc: Rpc, transport: ATransport): boolean;
    canDefer(rpc: Rpc, transport: ATransport): boolean;
    waitUntilReady(transport: ATransport, timeoutMs: number): Promise<boolean>;
    onRejected(rpc: Rpc, transport: ATransport): void;
    onExpired(rpc: Rpc, transport: ATransport): void;
}

type AdmissionQueue = {
    deferredRpcs: Rpc[];
    deferredRpcSet: WeakSet<Rpc>;
    waiting: boolean;
    unsubscribeDisconnected?: () => void;
    unsubscribeTransportClosed?: () => void;
};

export class DeferredAdmissionGuard extends AGuard<ARpcService<ARpcMethods>> {
    private readonly queueByTransport = new WeakMap<
        ATransport,
        AdmissionQueue
    >();

    constructor(
        service: ARpcService<ARpcMethods>,
        private readonly policy: DeferredAdmissionPolicy
    ) {
        super(service);
    }

    check(rpc: Rpc, transport: ATransport): boolean {
        return this.policy.isReady(rpc, transport);
    }

    onFailure(rpc: Rpc, transport: ATransport): void {
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

    suppressesFailureResponse(rpc: Rpc, transport: ATransport): boolean {
        return (
            this.queueByTransport.get(transport)?.deferredRpcSet.has(rpc) ??
            false
        );
    }

    clear(transport: ATransport): void {
        const queue = this.queueByTransport.get(transport);
        if (!queue) return;
        queue.unsubscribeDisconnected?.();
        queue.unsubscribeTransportClosed?.();
        queue.deferredRpcs.length = 0;
        queue.waiting = false;
        this.queueByTransport.delete(transport);
    }

    private getQueue(transport: ATransport): AdmissionQueue {
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
        transport: ATransport,
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
            for (const rpc of deferredRpcs) {
                this.service.runRPC(rpc, transport);
            }
            return;
        }

        if (deferredRpcs[0]) {
            this.policy.onExpired(deferredRpcs[0], transport);
        }
    }
}
