import type Rpc from "@/rpc/Rpc";
import type ATransport from "@/transport/ATransport";
import type ARpcService from "@/rpc/ARpcService";
import type ARpcMethods from "@/rpc/ARpcMethods";
import {
    DeferredAdmissionGuard,
    type DeferredAdmissionPolicy
} from "@/rpc/guards/DeferredAdmissionGuard";

export interface HandshakeCompletedGuardOptions {
    onFailure?: (rpc: Rpc, transport: ATransport) => void;
}

class HandshakeAdmissionPolicy implements DeferredAdmissionPolicy {
    constructor(
        private readonly service: ARpcService<ARpcMethods>,
        private readonly options?: HandshakeCompletedGuardOptions
    ) {}

    isReady(_rpc: Rpc, transport: ATransport): boolean {
        return this.isLiveAuthenticatedTransport(transport);
    }

    canDefer(_rpc: Rpc, transport: ATransport): boolean {
        return (
            this.options?.onFailure === undefined &&
            this.service.p2pManager.localRpc.initHandshakeService.isNegotiating(
                transport
            )
        );
    }

    waitUntilReady(transport: ATransport, timeoutMs: number): Promise<boolean> {
        return this.service.p2pManager.localRpc.initHandshakeService.waitForHandshakeCompleted(
            transport,
            timeoutMs
        );
    }

    onRejected(rpc: Rpc, transport: ATransport): void {
        if (this.options?.onFailure) {
            this.options.onFailure(rpc, transport);
            return;
        }
        this.rejectUnauthenticated(rpc, transport);
    }

    onExpired(rpc: Rpc, transport: ATransport): void {
        if (!this.isCurrentTransport(transport)) return;
        this.service.logger.warn(
            "Handshake did not complete before guarded RPC; disconnecting",
            {
                service: rpc.service,
                method: rpc.method,
                peerAddress: transport.peerAddress
            }
        );
        this.disconnectAndBlacklist(transport);
    }

    private isCurrentTransport(transport: ATransport): boolean {
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

    private isLiveAuthenticatedTransport(transport: ATransport): boolean {
        return this.isCurrentTransport(transport) && !!transport.peerAddress;
    }

    private rejectUnauthenticated(rpc: Rpc, transport: ATransport): void {
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
        this.disconnectAndBlacklist(transport);
    }

    private disconnectAndBlacklist(transport: ATransport): void {
        if (transport.peerAddress) {
            this.service.p2pManager.disconnectAndBlacklistPeerByEvmAddress(
                transport.peerAddress
            );
            return;
        }
        this.service.p2pManager.disconnectAndBlacklistPeer(transport);
    }
}

export class HandshakeCompletedGuard extends DeferredAdmissionGuard {
    constructor(
        service: ARpcService<ARpcMethods>,
        options?: HandshakeCompletedGuardOptions
    ) {
        super(service, new HandshakeAdmissionPolicy(service, options));
    }
}
