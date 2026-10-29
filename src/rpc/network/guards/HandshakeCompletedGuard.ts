import { DisconnectPolicy } from "@/DisconnectPolicy";
import type ANetworkRpcMethods from "@/rpc/network/ANetworkRpcMethods";
import type ANetworkRpcService from "@/rpc/network/ANetworkRpcService";
import {
    DeferredAdmissionGuard,
    type DeferredAdmissionPolicy
} from "@/rpc/network/guards/DeferredAdmissionGuard";
import type Rpc from "@/rpc/Rpc";
import type NetworkTransport from "@/transport/NetworkTransport";

export interface HandshakeCompletedGuardOptions {
    onFailure?: (rpc: Rpc, transport: NetworkTransport) => void;
}

class HandshakeAdmissionPolicy implements DeferredAdmissionPolicy {
    constructor(
        private readonly service: ANetworkRpcService<ANetworkRpcMethods>,
        private readonly options?: HandshakeCompletedGuardOptions
    ) {}

    isReady(_rpc: Rpc, transport: NetworkTransport): boolean {
        return this.isLiveAuthenticatedTransport(transport);
    }

    canDefer(_rpc: Rpc, transport: NetworkTransport): boolean {
        return (
            this.options?.onFailure === undefined &&
            this.service.p2pManager.localRpc.initHandshakeService.isNegotiating(
                transport
            )
        );
    }

    waitUntilReady(
        transport: NetworkTransport,
        timeoutMs: number
    ): Promise<boolean> {
        return this.service.p2pManager.localRpc.initHandshakeService.waitForHandshakeCompleted(
            transport,
            timeoutMs
        );
    }

    onRejected(rpc: Rpc, transport: NetworkTransport): void {
        if (this.options?.onFailure) {
            this.options.onFailure(rpc, transport);
            return;
        }
        this.rejectUnauthenticated(rpc, transport);
    }

    onExpired(rpc: Rpc, transport: NetworkTransport): void {
        if (!this.isCurrentTransport(transport)) return;
        this.service.logger.warn(
            "Handshake did not complete before guarded RPC; disconnecting",
            {
                service: rpc.service,
                method: rpc.method,
                peerAddress: transport.peerAddress
            }
        );
        // The waiter expired rather than the peer misbehaving, so this spends
        // the peer's shared retry bound instead of recording a verdict.
        this.service.p2pManager.disconnectConnection(
            transport,
            DisconnectPolicy.allowRetry()
        );
    }

    private isCurrentTransport(transport: NetworkTransport): boolean {
        if (
            this.service.p2pManager.isDisposed ||
            this.service.p2pManager.stateManager.isDisposed ||
            transport.isClosed
        ) {
            return false;
        }
        return (
            this.service.p2pManager.profileManager
                .getProfileByTransport(transport)
                ?.hasLiveTransport(transport) ?? false
        );
    }

    private isLiveAuthenticatedTransport(transport: NetworkTransport): boolean {
        return this.isCurrentTransport(transport) && !!transport.peerAddress;
    }

    private rejectUnauthenticated(rpc: Rpc, transport: NetworkTransport): void {
        if (transport.isClosed) return;
        const profile =
            this.service.p2pManager.profileManager.getProfileByTransport(
                transport
            );
        this.service.logger.warn(
            "Unauthenticated transport attempted guarded RPC; disconnecting",
            {
                peerAddress: profile?.evmAddress?.toString(),
                service: rpc.service,
                method: rpc.method
            }
        );
        this.service.p2pManager.disconnectConnection(
            transport,
            DisconnectPolicy.BLACKLIST,
            "guarded RPC from an unauthenticated transport"
        );
    }
}

export class HandshakeCompletedGuard extends DeferredAdmissionGuard {
    constructor(
        service: ANetworkRpcService<ANetworkRpcMethods>,
        options?: HandshakeCompletedGuardOptions
    ) {
        super(service, new HandshakeAdmissionPolicy(service, options));
    }
}
