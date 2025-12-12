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
        const completed = profile?.getIsHandshakeCompleted() ?? false;
        if (completed) {
            return true;
        }

        return false;
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
            "Handshake never completed; aborting RPC execution",
            {
                peerAddress
            }
        );
    }
}
