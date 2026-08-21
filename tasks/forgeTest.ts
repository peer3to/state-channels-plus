import { spawn } from "child_process";
import { task, types } from "hardhat/config";

// The parallel/distributed runner schedules Foundry test contracts as ordinary
// tasks, and the only process it spawns is the Hardhat CLI. A distributed
// worker executes the runner from its own checkout — only the project sources
// are synced to it — so the runner cannot learn to spawn another binary without
// updating every worker. hardhat.config.ts is a synced project source, so a
// task registered here reaches every worker as it is.
//
// This task deliberately does not depend on the compile task: the forge tier
// has its own build, warmed once before scheduling, and a per-task recompile
// would run on every scheduled task.

const FORGE_BIN = "forge";

// Matches DEFAULT_FORGE_THREADS in scripts/e2e-parallel/shared/constants.js,
// which every scheduled task passes explicitly. It only applies to a hand-typed
// invocation. `forge test` otherwise sizes its thread pool from the logical
// core count, which inside a CPU-limited container is still the host's count.
const DEFAULT_THREADS = 1;

/**
 * Run forge in the project root and resolve its exit code. `stdio: "inherit"`
 * hands forge this process's own stdout/stderr, so its output streams straight
 * into the runner's log capture. A null exit code means a signal or a failed
 * spawn — both failures.
 */
function runForge(args: string[], cwd: string) {
    return new Promise<number>((resolve) => {
        const child = spawn(FORGE_BIN, args, { cwd, stdio: "inherit" });
        child.on("error", (error) => {
            process.stderr.write(
                `Could not run \`${FORGE_BIN} ${args.join(" ")}\`: ${error.message}\n`
            );
            resolve(1);
        });
        child.on("close", (code) => resolve(code ?? 1));
    });
}

task("forge-test", "Run Foundry tests through the Hardhat CLI")
    .addParam(
        "matchContract",
        "Regular expression selecting the test contracts to run",
        undefined,
        types.string
    )
    .addOptionalParam(
        "threads",
        "Test threads for this forge run",
        DEFAULT_THREADS,
        types.int
    )
    .setAction(
        async (
            taskArgs: { matchContract: string; threads: number },
            hre
        ): Promise<void> => {
            const exitCode = await runForge(
                [
                    "test",
                    "--match-contract",
                    taskArgs.matchContract,
                    "--threads",
                    String(taskArgs.threads)
                ],
                hre.config.paths.root
            );
            // The runner reads pass/fail from the exit code, so pass forge's
            // through. Exit rather than throw so the log keeps forge's own
            // output instead of Hardhat's unexpected-error banner; stdio is
            // inherited, so this process has nothing buffered to flush.
            if (exitCode !== 0) process.exit(exitCode);
        }
    );
