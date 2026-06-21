import ARpcMethods from "@/rpc/ARpcMethods";
import type ATransport from "@/transport/ATransport";
import type { SignerService } from "./SignerService";

/**
 * Signer registration, executed host-side. Only public endpoints live here;
 * the registry/accessors are on {@link SignerService}.
 */
export class SignerRpcMethods extends ARpcMethods {
    constructor(
        transport: ATransport,
        private readonly service: SignerService
    ) {
        super(transport, service.p2pManager);
    }

    /** Register peer private keys for host-side cross-author re-signing. */
    public registerPeerSigners(secrets: string[]): boolean {
        this.service.registerPeerSigners(secrets);
        return true;
    }
}

export default SignerRpcMethods;
