// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import type { SignerService } from "./SignerService";
import ANetworkRpcMethods from "@/rpc/network/ANetworkRpcMethods";
import type NetworkTransport from "@/transport/NetworkTransport";

/**
 * Signer registration, executed host-side. Only public endpoints live here;
 * the registry/accessors are on {@link SignerService}.
 */
export class SignerRpcMethods extends ANetworkRpcMethods<SignerService> {
    constructor(transport: NetworkTransport, service: SignerService) {
        super(transport, service);
    }

    /** Register peer private keys for host-side cross-author re-signing. */
    public registerPeerSigners(secrets: string[]): boolean {
        this.service.registerPeerSigners(secrets);
        return true;
    }
}

export default SignerRpcMethods;
