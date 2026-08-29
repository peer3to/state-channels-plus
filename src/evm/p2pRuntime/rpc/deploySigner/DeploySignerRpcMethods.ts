import type { ethers } from "ethers";
import ARpcMethods from "@/rpc/ARpcMethods";
import type PortRpcRouter from "@/rpc/PortRpcRouter";
import type ATransport from "@/transport/ATransport";
import type { P2pRuntimeHostRoot } from "../P2pRuntimeHostRoot";
import type { DeploySignerService } from "./DeploySignerService";

/** a local-VM deploy, already mined: what the bridge signer's `wait()` returns */
export type DeployedTransaction = {
    hash: string;
    to: string | null;
    from: string;
    data: string;
    receipt: unknown;
};

export class DeploySignerRpcMethods extends ARpcMethods<
    PortRpcRouter<P2pRuntimeHostRoot>
> {
    constructor(
        transport: ATransport,
        private readonly service: DeploySignerService
    ) {
        super(transport, service.router);
    }

    getAddress(): Promise<string> {
        return this.service.host.deploySigner.getAddress();
    }

    getNonce(): Promise<number> {
        return this.service.host.deploySigner.getNonce();
    }

    resolveName(name: string): Promise<string | null> {
        return this.service.host.deploySigner.resolveName(name);
    }

    call(tx: unknown): Promise<string> {
        return this.service.host.deploySigner.call(
            tx as ethers.TransactionRequest
        );
    }

    async sendTransaction(tx: unknown): Promise<DeployedTransaction> {
        const deployTx = await this.service.host.deploySigner.sendTransaction(
            tx as ethers.TransactionRequest
        );
        return {
            hash: deployTx.hash,
            to: deployTx.to,
            from: deployTx.from,
            data: (deployTx as any).data,
            receipt: await deployTx.wait()
        };
    }
}

export default DeploySignerRpcMethods;
