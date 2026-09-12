import type { P2pRuntimeHostRoot } from "../P2pRuntimeHostRoot";
import ARpcMethods from "@/rpc/ARpcMethods";
import type { RpcRouter } from "@/rpc/RpcRouter";
import type { ethers } from "ethers";

/** a local-VM deploy, already mined: what the bridge signer's `wait()` returns */
type DeployedTransaction = {
    hash: string;
    to: string | null;
    from: string;
    data: string;
    receipt: unknown;
};

export class DeploySignerRpcMethods extends ARpcMethods<
    RpcRouter<P2pRuntimeHostRoot, any>
> {
    async getAddress(): Promise<string> {
        return (await this.localRpc.host.deploySigner()).getAddress();
    }

    async getNonce(): Promise<number> {
        return (await this.localRpc.host.deploySigner()).getNonce();
    }

    async resolveName(name: string): Promise<string | null> {
        return (await this.localRpc.host.deploySigner()).resolveName(name);
    }

    async call(tx: ethers.TransactionRequest): Promise<string> {
        return (await this.localRpc.host.deploySigner()).call(tx);
    }

    async sendTransaction(
        tx: ethers.TransactionRequest
    ): Promise<DeployedTransaction> {
        const signer = await this.localRpc.host.deploySigner();
        const deployTx = await signer.sendTransaction(tx);
        return {
            hash: deployTx.hash,
            to: deployTx.to,
            from: deployTx.from,
            data: deployTx.data,
            receipt: await deployTx.wait()
        };
    }
}

export default DeploySignerRpcMethods;
