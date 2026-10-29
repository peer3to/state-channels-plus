const { spawn } = require("child_process");

/**
 * Run one tier's external process and resolve its exit code — the runner reads
 * pass/fail from that code, and a signal exit counts as a failure. `describe`
 * names the command in the message written when it cannot be run at all, for a
 * tier whose real command reads better than its argv (a gate spawns
 * `process.execPath`, not `node`).
 */
function runTierProcess(command, args, cwd, options = {}) {
    return new Promise((resolve) => {
        const child = spawn(command, args, {
            cwd,
            stdio: options.stdio ?? "inherit",
            env: options.env ?? process.env
        });
        child.on("error", (error) => {
            const described = options.describe ?? [command, ...args].join(" ");
            (options.stderr || process.stderr).write(
                `Could not run \`${described}\`: ${error.message}\n`
            );
            resolve(1);
        });
        child.on("close", (code) => resolve(code ?? 1));
    });
}

module.exports = { runTierProcess };
