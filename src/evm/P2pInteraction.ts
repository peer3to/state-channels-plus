import P2pSigner from "./P2pSigner";
import { AStateMachine } from "@typechain-types";
import P2pEventHooks from "@/P2pEventHooks";

/**
 * Represents a P2P interaction with a state machine contract
 */
export class P2pInteraction<T extends AStateMachine> {
    p2pContractInstance: T;
    p2pSigner: P2pSigner;

    constructor(p2pContractInstance: T, p2pSigner: P2pSigner) {
        this.p2pContractInstance = p2pContractInstance;
        this.p2pSigner = p2pSigner;
    }

    /**
     * Cleans up resources used by the P2P interaction
     */
    public async dispose() {
        this.p2pContractInstance.removeAllListeners();
        await this.p2pSigner.p2pManager.stateManager.dispose();
    }

    /**
     * Sets event hooks for the P2P interaction
     * @param p2pEventHooks The event hooks to set
     */
    public setHooks(p2pEventHooks: P2pEventHooks) {
        this.p2pSigner.p2pManager.stateManager.setP2pEventHooks(p2pEventHooks);
    }
}