import type { Worker } from "node:worker_threads";
import { config } from "@/utils/config";

// Measure how long an SDK worker takes to come up, to see how much of test
// startup is worker boot and whether the .ts path is using fast swc transpile vs
// slow ts-node type-checking. Enabled with the event-loop monitor threshold
// (tests only) so production worker creation stays silent.
//
//   t0 → "online"  : Node worker init + the execArgv register preload (ts-node)
//   online → first : entry script running — the SDK import graph transpile+load
//
// Emits a marker the runner sums (workerBootMs) and logs a per-worker breakdown.
export function instrumentWorkerStartup(
    worker: Worker,
    kind: string,
    transpiler: string
): void {
    if (config.EVENT_LOOP_DELAY_ERROR_THRESHOLD_SECONDS <= 0) return;

    const t0 = Date.now();
    let onlineMs = -1;
    worker.once("online", () => {
        onlineMs = Date.now() - t0;
    });
    worker.once("message", () => {
        const readyMs = Date.now() - t0;
        const loadMs = onlineMs >= 0 ? readyMs - onlineMs : readyMs;
        try {
            process.stdout.write(
                `##E2E_TIMING## ${JSON.stringify({ workerBootMs: readyMs })}\n`
            );
        } catch {
            // stdout may be closed during teardown — ignore.
        }
        // eslint-disable-next-line no-console
        console.error(
            `[worker:${kind}] ready ${readyMs}ms = online ${onlineMs}ms + load ${loadMs}ms (${transpiler})`
        );
    });
}
