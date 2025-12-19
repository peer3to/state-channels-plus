import P2pSigner from "./P2pSigner";
import { AStateMachine } from "@typechain-types";
import P2pEventHooks from "@/P2pEventHooks";
import type { RpcServiceFactoryMap } from "@/rpc/registry";

export default class P2pInstance<
    T extends AStateMachine,
    TFactories extends RpcServiceFactoryMap = {}
> {
    p2pContractInstance: T;
    p2pSigner: P2pSigner<TFactories>;

    constructor(p2pContractInstance: T, p2pSigner: P2pSigner<TFactories>) {
        this.p2pContractInstance = p2pContractInstance;
        this.p2pSigner = p2pSigner;
    }

    public dispose() {
        return Promise.all([
            this.p2pContractInstance.removeAllListeners(),
            this.p2pSigner.p2pManager.stateManager.dispose()
        ]);
    }

    public setHooks(p2pEventHooks: P2pEventHooks) {
        this.p2pSigner.p2pManager.stateManager.setP2pEventHooks(p2pEventHooks);
    }
}
