import { type RootStartContext } from "../createRoot";
import {
    ContractExecutorService,
    type ContractExecutorInitialization
} from "../services/contractExecutor/ContractExecutorService";
import { AInternalRpcRoot } from "@/rpc/internal/AInternalRpcRoot";
import { createConfig } from "@/utils/config";

export class ContractExecutorRoot extends AInternalRpcRoot {
    public readonly executor: ContractExecutorService;

    constructor(
        private readonly initialization: ContractExecutorInitialization,
        _local: undefined,
        context: RootStartContext
    ) {
        // Re-establish config in this worker and build its logger, then monitor
        // this thread with the same fatal delay threshold as every service loop.
        if (context.mode === "worker") createConfig(initialization.config);
        super(
            (error) => {
                throw error;
            },
            null,
            context
        );
        this.executor = new ContractExecutorService(
            this.router,
            this.rootLogger
        );
    }

    // Implements root cleanup through the shared recursive disposal contract.
    public override dispose(): Promise<void> {
        return this.disposeRoot(
            () => {
                this.executor.dispose();
            },
            // Admitted EVM work may still call a child (a custom precompile),
            // so it settles before children are disposed.
            () => this.executor.closeAdmission()
        );
    }

    /**
     * Overrides AInternalRpcRoot.reportError to record an error caught outside any request (the platform funnel's
     * uncaught exception, unhandled rejection, or the watchdog's throw). The
     * worker keeps serving; the executor decides what the report means.
     * Usable after executor service construction, before request handling starts.
     */
    public override reportError(error: unknown): void {
        this.executor.recordDetachedError(error);
        super.reportError(error);
    }

    /** Load the executor after common startup has installed its parent connection. */
    public async start(): Promise<void> {
        await this.executor.init(this.initialization);
    }
}
