import { AStateMachine } from "@typechain-types";
import P2pEventHooks from "@/P2pEventHooks";
import { inject, ServiceNames } from "@/container";

export default class P2pInstance<T extends AStateMachine> {
    p2pContractInstance: T;

    constructor(p2pContractInstance: T) {
        this.p2pContractInstance = p2pContractInstance;
    }

    private get stateManager() {
        return inject(ServiceNames.STATE_MANAGER);
    }

    public async dispose() {
        this.p2pContractInstance.removeAllListeners();
        await this.stateManager.dispose();
    }

    public setHooks(p2pEventHooks: P2pEventHooks) {
        this.stateManager.setP2pEventHooks(p2pEventHooks);
    }
}
