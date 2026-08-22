const fs = require("fs");
const path = require("path");
const { buildWorkerEnvironment } = require("./remoteEnvironment");

function run(command, args, options) {
    if (!options.commandRunner) {
        throw new Error(
            "Workspace preparation requires an isolated command runner"
        );
    }
    return options.commandRunner.run(command, args, options);
}

async function nativeModulesLoad(repository, cwd, options, env) {
    const modules = repository.verifyNativeModules || [];
    if (!modules.length) return true;
    try {
        await run(
            "node",
            [
                "-e",
                `for (const name of ${JSON.stringify(modules)}) require(name)`
            ],
            { ...options, cwd, env }
        );
        return true;
    } catch {
        return false;
    }
}

function hasContractCompileChanges(repository, cache) {
    const prefix = `${repository.path}/`;
    const compileInputs = repository.contractCompileInputs || [];
    return [...cache.changed, ...cache.deleted].some((entry) =>
        compileInputs.some((input) => {
            const target = `${prefix}${input}`;
            return (
                entry === target ||
                (input.endsWith("/") && entry.startsWith(target))
            );
        })
    );
}

function selectPrepareScript(repository, cache, repositories = [repository]) {
    if (cache.preparationChanged || cache.contractPreparationChanged) {
        return repository.prepareScript;
    }
    const prefix = `${repository.path}/`;
    const repositoryChanged = [...cache.changed, ...cache.deleted].some(
        (entry) => entry.startsWith(prefix)
    );
    const repositoryIndex = repositories.findIndex(
        (candidate) => candidate.path === repository.path
    );
    const dependencies = repositories.slice(
        0,
        repositoryIndex < 0 ? repositories.length : repositoryIndex + 1
    );
    const dependencyContractsChanged = dependencies.some((candidate) =>
        hasContractCompileChanges(candidate, cache)
    );
    if (!repositoryChanged && !dependencyContractsChanged) return null;
    if (!repository.cachedPrepareScript) return repository.prepareScript;
    return hasContractCompileChanges(repository, cache)
        ? repository.prepareScript
        : repository.cachedPrepareScript;
}

async function prepareWorkspace(workspaceRoot, manifest, options) {
    const storeDir = options.storeDir;
    if (!storeDir) throw new Error("Isolated package store is required");
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
                    "--store-dir",
                    storeDir,
                    ...(repository.hasYarnLock && !repository.hasPnpmLock
                        ? ["--shamefully-hoist"]
                        : []),
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
        // A pnpm that skipped approved build scripts (or a cached workspace
        // installed by one) leaves script-built native modules without their
        // binding. Verify the declared ones load; rebuild once before failing
        // the preparation loudly.
        if (!(await nativeModulesLoad(repository, cwd, options, env))) {
            const modules = repository.verifyNativeModules;
            options.onStage?.(
                `Rebuilding native modules for ${repository.name}`
            );
            options.onOutput(
                "stdout",
                Buffer.from(
                    `Rebuilding native modules for ${repository.name}: ${modules.join(", ")}\n`
                )
            );
            await run("pnpm", ["rebuild", ...modules], {
                ...options,
                cwd,
                env
            });
            if (!(await nativeModulesLoad(repository, cwd, options, env))) {
                throw new Error(
                    `Native modules failed to load after rebuild in ${repository.name}: ${modules.join(", ")}`
                );
            }
        }
        const prepareScript = options.selectPrepareScript
            ? options.selectPrepareScript(repository)
            : repository.prepareScript;
        if (prepareScript) {
            options.onStage?.(`Building ${repository.name}`);
            options.onOutput(
                "stdout",
                Buffer.from(
                    `Preparing ${repository.name} with ${prepareScript}\n`
                )
            );
            await run("pnpm", ["run", prepareScript], {
                ...options,
                cwd,
                env
            });
        }
    }
}

module.exports = { prepareWorkspace, selectPrepareScript };
