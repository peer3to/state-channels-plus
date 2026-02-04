import P2pSigner from "./P2pSigner";
import { AStateMachine } from "@typechain-types";
import P2pEventHooks from "@/P2pEventHooks";
import type { RpcServiceFactoryMap } from "@/rpc/registry";
import { Logger } from "@/utils";

export default class P2pInstance<
    T extends AStateMachine,
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    TFactories extends RpcServiceFactoryMap = {}
> {
    p2pContractInstance: T;
    p2pSigner: P2pSigner<TFactories>;
    logger: Logger;

    constructor(
        p2pContractInstance: T,
        p2pSigner: P2pSigner<TFactories>,
        logger: Logger
    ) {
        this.p2pContractInstance = p2pContractInstance;
        this.p2pSigner = p2pSigner;
        this.logger = logger;
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
