import { ChainSignerRpcMethods } from "./ChainSignerRpcMethods";
import type HostNonceManager from "@/evm/signer/HostNonceManager";
import { AInternalRpcService } from "@/rpc/internal/AInternalRpcService";
import type { InternalRpcRouter } from "@/rpc/router/InternalRpcRouter";
import type InternalTransport from "@/transport/InternalTransport";

export class ChainSignerService extends AInternalRpcService<ChainSignerRpcMethods> {
    constructor(
        router: InternalRpcRouter,
        public readonly chainSigner: HostNonceManager
    ) {
        super(router);
    }
    public createRPCMethods(sender: InternalTransport) {
        return new ChainSignerRpcMethods(this, sender);
    }
}
