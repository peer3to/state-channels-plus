import P2pSigner from "./P2pSigner";
import { AStateMachine } from "@typechain-types";
import P2pEventHooks from "@/P2pEventHooks";
import MainRpcService from "@/rpc/MainRpcService";
import { Logger } from "@/utils";

export default class P2pInstance<
    T extends AStateMachine,
    TCustomRpc extends MainRpcService = MainRpcService
> {
    p2pContractInstance: T;
    p2pSigner: P2pSigner<TCustomRpc>;
    logger: Logger;

    constructor(
        p2pContractInstance: T,
        p2pSigner: P2pSigner<TCustomRpc>,
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
