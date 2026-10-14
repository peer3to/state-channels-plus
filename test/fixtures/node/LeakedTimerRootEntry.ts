// @spec-test-coverage-ignore: real worker fault entry exercised by RootWorkerDrain.test.ts
import { startRootWorker } from "@/rpc/internal/createRoot";
import { ContractExecutorRoot } from "@/rpc/internal/roots/ContractExecutorRoot";

/** Longer than the drain bound, so the timer is still pending when it fires. */
const LEAKED_TIMER_MS = 60 * 60 * 1000;

class LeakedTimerExecutorRoot extends ContractExecutorRoot {
    // Overrides ContractExecutorRoot.dispose to leave a referenced timer
    // behind; closeRootWorker cannot see or close JS timers.
    public override dispose(): Promise<void> {
        setInterval(() => {}, LEAKED_TIMER_MS);
        return super.dispose();
    }
}

startRootWorker(LeakedTimerExecutorRoot);
