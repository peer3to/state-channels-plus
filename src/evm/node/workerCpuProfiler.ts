import * as fs from "node:fs";
import * as path from "node:path";

// Env-gated V8 CPU profiler for worker threads (diagnostics only). Enabled by
// setting SCP_CPU_PROFILE_DIR; profiles land there as .cpuprofile files.
//
// A failed worker may still require forced shutdown, so a profile that only
// writes on clean exit could be lost. Instead the profile is flushed in
// chunks (SCP_CPU_PROFILE_FLUSH_MS, default 5s) and once more on
// uncaughtException — the event-loop starvation watchdog throws, so the chunk
// containing the stall is written before the worker exits.
export function startCpuProfilerIfEnabled(label: string): void {
    const dir = process.env.SCP_CPU_PROFILE_DIR;
    if (!dir) return;
    const flushMs = Number(process.env.SCP_CPU_PROFILE_FLUSH_MS) || 5000;

    void (async () => {
        const [inspector, workerThreads] = await Promise.all([
            import("node:inspector"),
            import("node:worker_threads")
        ]);
        const session = new inspector.Session();
        session.connect();
        const post = (method: string, params?: object): Promise<unknown> =>
            new Promise((resolve, reject) =>
                (session.post as Function)(
                    method,
                    params,
                    (err: Error | null, result: unknown) =>
                        err ? reject(err) : resolve(result)
                )
            );

        fs.mkdirSync(dir, { recursive: true });
        await post("Profiler.enable");
        await post("Profiler.setSamplingInterval", { interval: 500 });
        await post("Profiler.start");

        const base = `${label}-pid${process.pid}-t${workerThreads.threadId}`;
        let chunk = 0;
        let flushing = false;
        const flush = async () => {
            if (flushing) return;
            flushing = true;
            try {
                const { profile } = (await post("Profiler.stop")) as {
                    profile: unknown;
                };
                fs.writeFileSync(
                    path.join(dir, `${base}-c${chunk++}.cpuprofile`),
                    JSON.stringify(profile)
                );
                await post("Profiler.start");
            } catch {
                // Session may be gone during teardown — ignore.
            } finally {
                flushing = false;
            }
        };

        setInterval(() => void flush(), flushMs).unref();
        // Run before other handlers so the stall chunk gets written even if the
        // error is about to take the worker down.
        process.prependListener("uncaughtException", () => void flush());
    })().catch(() => {
        // Profiling is best-effort; never take the worker down over it.
    });
}
