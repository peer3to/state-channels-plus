import { P2pSignerRpcMethods } from "./P2pSignerRpcMethods";
import type P2pSigner from "@/evm/signer/LocalP2pSigner";
import { AInternalRpcService } from "@/rpc/internal/AInternalRpcService";
import type { InternalRpcRouter } from "@/rpc/router/InternalRpcRouter";
import type InternalTransport from "@/transport/InternalTransport";
import type { ethers } from "ethers";

export class P2pSignerService extends AInternalRpcService<P2pSignerRpcMethods> {
    constructor(
        router: InternalRpcRouter,
        public readonly requireP2pSigner: () => P2pSigner,
        public readonly signer: ethers.Signer
    ) {
        super(router);
    }
    public createRPCMethods(sender: InternalTransport) {
        return new P2pSignerRpcMethods(this, sender);
    }
}
