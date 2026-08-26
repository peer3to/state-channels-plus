const { spawn } = require("child_process");
const { FORGE_BIN } = require("./forgeConfig");

function runForge(args, cwd, options = {}) {
    return new Promise((resolve) => {
        const child = spawn(FORGE_BIN, args, {
            cwd,
            stdio: options.stdio ?? "inherit",
            env: options.env ?? process.env
        });
        child.on("error", (error) => {
            (options.stderr || process.stderr).write(
                `Could not run \`${FORGE_BIN} ${args.join(" ")}\`: ${error.message}\n`
            );
            resolve(1);
        });
        child.on("close", (code) => resolve(code ?? 1));
    });
}

module.exports = { runForge };
