import P2pSigner from "./P2pSigner";
import { AStateMachine } from "@typechain-types";
import P2pEventHooks from "@/P2pEventHooks";

export default class P2pInstance<T extends AStateMachine> {
    p2pContractInstance: T;
    p2pSigner: P2pSigner;

    constructor(p2pContractInstance: T, p2pSigner: P2pSigner) {
        this.p2pContractInstance = p2pContractInstance;
        this.p2pSigner = p2pSigner;
    }

    public async dispose() {
        this.p2pContractInstance.removeAllListeners();
        await this.p2pSigner.p2pManager.stateManager.dispose();
    }

    public setHooks(p2pEventHooks: P2pEventHooks) {
        this.p2pSigner.p2pManager.stateManager.setP2pEventHooks(p2pEventHooks);
    }
}
