import Rpc from "@/rpc/Rpc";
import ATransport from "@/transport/ATransport";
import { AGuard } from "@/rpc/guards/AGuard";
import ARpcService from "@/rpc/ARpcService";
import ARpcMethods from "@/rpc/ARpcMethods";

export interface HandshakeCompletedGuardOptions {
    onFailure?: (rpc: Rpc, transport: ATransport) => void;
}

class RpcQueue {
    private readonly queue: Rpc[] = [];
    private waiting = false;

    enqueue(rpc: Rpc): void {
        this.queue.push(rpc);
    }

    isWaiting(): boolean {
        return this.waiting;
    }

    markWaiting(waiting: boolean): void {
        this.waiting = waiting;
    }

    drain(handler: (rpc: Rpc) => void): void {
        while (this.queue.length > 0) {
            const next = this.queue.shift();
            if (!next) break;
            handler(next);
        }
    }

    clear(): void {
        this.queue.length = 0;
        this.waiting = false;
    }
}

export class HandshakeCompletedGuard extends AGuard<ARpcService<ARpcMethods>> {
    private readonly rpcQueueByTransport: WeakMap<ATransport, RpcQueue> =
        new WeakMap();

    constructor(
        service: ARpcService<ARpcMethods>,
        private readonly options?: HandshakeCompletedGuardOptions
    ) {
        super(service);
    }

    check(_rpc: Rpc, transport: ATransport): boolean {
        const profile =
            this.service.p2pManager.profileManager.getProfileByTransport(
                transport
            );
        return !!profile && profile.getIsHandshakeCompleted();
    }

    private getQueue(transport: ATransport): RpcQueue {
        const existing = this.rpcQueueByTransport.get(transport);
        if (existing) return existing;
        const created = new RpcQueue();
        this.rpcQueueByTransport.set(transport, created);
        return created;
    }

    onFailure(rpc: Rpc, transport: ATransport): void {
        if (this.options?.onFailure) {
            return this.options.onFailure(rpc, transport);
        }
        const initHandshakeService =
            this.service.p2pManager.localRpc.initHandshakeService;

        // If the handshake negotiation is in progress for this transport, wait up to
        // agreementTime for it to complete and retry the RPC (return early via EventBarrier).
        if (initHandshakeService.isNegotiating(transport)) {
            const queue = this.getQueue(transport);
            queue.enqueue(rpc);

            // Only start one waiter per transport; additional RPCs enqueue behind it.
            if (queue.isWaiting()) {
                return;
            }
            queue.markWaiting(true);

            const timeoutMs =
                this.service.p2pManager.stateManager.timeConfig.agreementTime *
                2 *
                1000;

            void (async () => {
                const completed =
                    await initHandshakeService.waitForHandshakeCompleted(
                        transport,
                        timeoutMs
                    );

                // Stop gating new waiters; if more RPCs arrive after this point,
                // either handshake is complete (guard will pass) or they will enqueue
                // and start a new waiter (in the timeout case).
                queue.markWaiting(false);

                if (completed) {
                    // Replay in original arrival order.
                    queue.drain((queued) => {
                        this.service.runRPC(queued, transport);
                    });
                    return;
                }

                queue.clear();

                // Negotiation timed out; treat as failure.
                this.service.logger.warn(
                    "Handshake did not complete before guarded RPC; disconnecting",
                    {
                        service: rpc.service,
                        method: rpc.method,
                        peerAddress: transport.peerAddress
                    }
                );

                if (transport.peerAddress) {
                    this.service.p2pManager.disconnectAndBlacklistPeerByEvmAddress(
                        transport.peerAddress
                    );
                    return;
                }
                this.service.p2pManager.disconnectAndBlacklistPeer(transport);
            })();

            return;
        }

        const profile =
            this.service.p2pManager.profileManager.getProfileByTransport(
                transport
            );
        const peerAddress = profile?.evmAddress?.toString();

        this.service.logger.warn(
            "No peer profile for transport; disconnecting",
            {
                peerAddress,
                service: rpc.service,
                method: rpc.method
            }
        );

        // Any guarded RPC over an unverified transport is considered malicious.
        if (transport.peerAddress) {
            this.service.p2pManager.disconnectAndBlacklistPeerByEvmAddress(
                transport.peerAddress
            );
            return;
        }

        this.service.p2pManager.disconnectAndBlacklistPeer(transport);
    }
}
