// @spec-test-coverage-ignore: Runtime lifecycle fixture exercised by owning E2E declarations.
import type P2PManager from "@/P2PManager";
import { HarnessControlRpc } from "./harnessControl/HarnessControlRpc";
import { MutexProbeService } from "./mutexProbe/MutexProbeService";

export type ReadyLifecycleRpcOptions = {
    delayMs?: number;
    reject?: boolean;
};

export class ReadyLifecycleRpc extends HarnessControlRpc {
    public readonly mutexProbe: MutexProbeService;
    private readonly options: ReadyLifecycleRpcOptions;
    private readyPromise?: Promise<void>;

    constructor(
        p2pManager: P2PManager<ReadyLifecycleRpc>,
        options: ReadyLifecycleRpcOptions = {}
    ) {
        super(p2pManager);
        this.options = options;
        this.mutexProbe = new MutexProbeService(p2pManager);
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
