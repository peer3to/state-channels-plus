import Rpc from "@/rpc/Rpc";
import ATransport from "@/transport/ATransport";
import { AGuard } from "@/rpc/guards/AGuard";
import ARpcService from "@/rpc/ARpcService";
import ARpcMethods from "@/rpc/ARpcMethods";

export interface HandshakeCompletedGuardOptions {
    onFailure?: (rpc: Rpc, transport: ATransport) => void;
}

export class HandshakeCompletedGuard extends AGuard<ARpcService<ARpcMethods>> {
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
        return !!profile; // If the profile exists, we've verified the remote, regardless if the remote verfied us, so this is enough for receiving RPCs
    }

    onFailure(rpc: Rpc, transport: ATransport): void {
        if (this.options?.onFailure) {
            return this.options.onFailure(rpc, transport);
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

        // With the new connection semantics, any guarded RPC over an unverified
        // transport is considered malicious.
        if (transport.peerAddress) {
            this.service.p2pManager.disconnectAndBlacklistPeerByEvmAddress(
                transport.peerAddress
            );
            return;
        }

        this.service.p2pManager.disconnectAndBlacklistPeer(transport);
    }
}
