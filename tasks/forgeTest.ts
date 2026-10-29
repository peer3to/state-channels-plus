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

const { FORGE_TEST_TASK, DEFAULT_FORGE_THREADS } =
    require("../scripts/e2e-parallel/shared/forgeConfig") as {
        FORGE_TEST_TASK: string;
        DEFAULT_FORGE_THREADS: number;
    };
const { runForge } = require("../scripts/e2e-parallel/shared/forgeRunner") as {
    runForge: (args: string[], cwd: string) => Promise<number>;
};

task(FORGE_TEST_TASK, "Run Foundry tests through the Hardhat CLI")
    .addParam(
        "matchContract",
        "Regular expression selecting the test contracts to run",
        undefined,
        types.string
    )
    .addOptionalParam(
        "threads",
        "Test threads for this forge run",
        DEFAULT_FORGE_THREADS,
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
