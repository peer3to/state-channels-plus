import { DeploySignerRpcMethods } from "./DeploySignerRpcMethods";
import type LocalContractExecutorSigner from "@/evm/signer/LocalContractExecutorSigner";
import { AInternalRpcService } from "@/rpc/internal/AInternalRpcService";
import type { InternalRpcRouter } from "@/rpc/router/InternalRpcRouter";
import type InternalTransport from "@/transport/InternalTransport";

export class DeploySignerService extends AInternalRpcService<DeploySignerRpcMethods> {
    constructor(
        router: InternalRpcRouter,
        private readonly getDeploySigner: () => LocalContractExecutorSigner
    ) {
        super(router);
    }
    public get deploySigner() {
        return this.getDeploySigner();
    }
    public createRPCMethods(sender: InternalTransport) {
        return new DeploySignerRpcMethods(this, sender);
    }
}
