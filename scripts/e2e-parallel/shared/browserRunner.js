const { spawn } = require("child_process");

/** A browser gate is a plain Node entry point: `node <gate>.mjs`. */
function runBrowserGate(scriptPath, cwd, options = {}) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [scriptPath], {
            cwd,
            stdio: options.stdio ?? "inherit",
            env: options.env ?? process.env
        });
        child.on("error", (error) => {
            (options.stderr || process.stderr).write(
                `Could not run \`node ${scriptPath}\`: ${error.message}\n`
            );
            resolve(1);
        });
        child.on("close", (code) => resolve(code ?? 1));
    });
}

module.exports = { runBrowserGate };
