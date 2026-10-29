// @spec-test-coverage-ignore: real worker fault entry exercised by RootCreation.test.ts
import { startRootWorker } from "@/rpc/internal/createRoot";
import { ContractExecutorRoot } from "@/rpc/internal/roots/ContractExecutorRoot";

class ExitingContractExecutorRoot extends ContractExecutorRoot {
    // Overrides ContractExecutorRoot.start to install a worker-exit disposal fault.
    public override async start(
        ...args: Parameters<ContractExecutorRoot["start"]>
    ) {
        await super.start(...args);
        // End the actual worker while its parent is awaiting the disposal reply.
        this.dispose = () => process.exit(23);
    }
}

startRootWorker(ExitingContractExecutorRoot);
