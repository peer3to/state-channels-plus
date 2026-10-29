import { task, types } from "hardhat/config";

// The parallel/distributed runner schedules browser gates as ordinary tasks,
// and the only process it spawns is the Hardhat CLI. A distributed worker
// executes the runner from its own checkout — only the project sources are
// synced to it — so the runner cannot learn to spawn another binary without
// updating every worker. hardhat.config.ts is a synced project source, so a
// task registered here reaches every worker as it is.
//
// This task deliberately does not depend on the compile task: the browser tier
// has its own build, warmed once before scheduling, and a per-task recompile
// would run on every scheduled task.

const { BROWSER_TEST_TASK } =
    require("../scripts/e2e-parallel/shared/browserConfig") as {
        BROWSER_TEST_TASK: string;
    };
const { runBrowserGate } =
    require("../scripts/e2e-parallel/shared/browserRunner") as {
        runBrowserGate: (scriptPath: string, cwd: string) => Promise<number>;
    };

task(BROWSER_TEST_TASK, "Run a browser gate through the Hardhat CLI")
    .addParam(
        "script",
        "Browser gate entry point to run",
        undefined,
        types.inputFile
    )
    .setAction(async (taskArgs: { script: string }, hre): Promise<void> => {
        const exitCode = await runBrowserGate(
            taskArgs.script,
            hre.config.paths.root
        );
        // The runner reads pass/fail from the exit code, so pass the gate's
        // through. Exit rather than throw so the log keeps the gate's own
        // output instead of Hardhat's unexpected-error banner; stdio is
        // inherited, so this process has nothing buffered to flush.
        if (exitCode !== 0) process.exit(exitCode);
    });
