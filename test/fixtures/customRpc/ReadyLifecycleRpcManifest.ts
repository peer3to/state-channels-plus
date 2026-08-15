import type P2PManager from "@/P2PManager";
import { HarnessControlRpc } from "./harnessControl/HarnessControlRpc";

export type ReadyLifecycleRpcOptions = {
    delayMs?: number;
    reject?: boolean;
};

export class ReadyLifecycleRpc extends HarnessControlRpc {
    private readonly options: ReadyLifecycleRpcOptions;
    private readyPromise?: Promise<void>;

    constructor(
        p2pManager: P2PManager<ReadyLifecycleRpc>,
        options: ReadyLifecycleRpcOptions = {}
    ) {
        super(p2pManager);
        this.options = options;
    }

    public override ready(): Promise<void> {
        this.readyPromise ??= this.runReady();
        return this.readyPromise;
    }

    private async runReady(): Promise<void> {
        if (this.options.delayMs) {
            await new Promise((resolve) =>
                setTimeout(resolve, this.options.delayMs)
            );
        }
        if (this.options.reject) throw new Error("root ready boom");
    }
}

export default ReadyLifecycleRpc;
