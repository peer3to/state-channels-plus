const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { buildWorkerEnvironment } = require("./remoteEnvironment");

function run(command, args, options) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd: options.cwd,
            env: options.env,
            stdio: ["ignore", "pipe", "pipe"],
            detached: process.platform !== "win32"
        });
        options.runtime.addChild(child);
        child.stdout.on("data", (data) => options.onOutput("stdout", data));
        child.stderr.on("data", (data) => options.onOutput("stderr", data));
        child.once("error", reject);
        child.once("exit", (code, signal) => {
            if (code === 0) resolve();
            else
                reject(
                    new Error(
                        `${command} ${args.join(" ")} failed (${code ?? signal})`
                    )
                );
        });
    });
}

async function prepareWorkspace(workspaceRoot, manifest, options) {
    const storeDir = path.join(options.workRoot, "pnpm-store");
    fs.mkdirSync(storeDir, { recursive: true });
    const env = {
        ...buildWorkerEnvironment(process.env),
        ...options.env,
        HUSKY: "0"
    };
    for (const repository of manifest.repositories) {
        const cwd = path.join(workspaceRoot, repository.path);
        const install = options.shouldInstall?.(repository) !== false;
        options.onStage?.(
            install
                ? `Installing dependencies for ${repository.name}`
                : `Reusing dependencies for ${repository.name}`
        );
        if (install) {
            options.onOutput(
                "stdout",
                Buffer.from(`Installing ${repository.name}\n`)
            );
            if (!repository.hasPnpmLock && repository.hasYarnLock) {
                options.onOutput(
                    "stdout",
                    Buffer.from(
                        `Importing ${repository.name} dependency versions from yarn.lock\n`
                    )
                );
                await run("pnpm", ["import"], { ...options, cwd, env });
            }
            await run(
                "pnpm",
                [
                    "install",
                    "--config.dangerously-allow-all-builds=true",
                    "--store-dir",
                    storeDir,
                    repository.hasPnpmLock
                        ? "--frozen-lockfile"
                        : repository.hasYarnLock
                          ? "--frozen-lockfile"
                          : "--no-frozen-lockfile"
                ],
                { ...options, cwd, env }
            );
        } else {
            options.onOutput(
                "stdout",
                Buffer.from(`Reusing dependencies for ${repository.name}\n`)
            );
        }
        if (repository.prepareScript) {
            options.onStage?.(`Building ${repository.name}`);
            options.onOutput(
                "stdout",
                Buffer.from(`Preparing ${repository.name}\n`)
            );
            await run("pnpm", ["run", repository.prepareScript], {
                ...options,
                cwd,
                env
            });
        }
    }
}

module.exports = { prepareWorkspace };
