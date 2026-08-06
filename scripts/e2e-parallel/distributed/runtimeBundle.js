const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const tar = require("tar");
const { sha256File } = require("../shared/fileHash");

function readPackageJson(root) {
    return JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
}

function linkedRepositoryPaths(root) {
    const packageJson = readPackageJson(root);
    const dependencies = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
        ...packageJson.optionalDependencies
    };
    const linked = [];
    for (const specifier of Object.values(dependencies)) {
        if (typeof specifier !== "string") continue;
        const match = specifier.match(/^(?:link|file):(.+)$/);
        if (!match) continue;
        const target = fs.realpathSync(path.resolve(root, match[1]));
        if (!fs.existsSync(path.join(target, "package.json"))) {
            throw new Error(`Linked dependency is not a package: ${target}`);
        }
        linked.push(target);
    }
    return linked;
}

function discoverRepositories(projectRoot) {
    const root = fs.realpathSync(projectRoot);
    const discovered = [];
    const seen = new Set();
    const visit = (repositoryRoot) => {
        const resolved = fs.realpathSync(repositoryRoot);
        if (seen.has(resolved)) return;
        seen.add(resolved);
        const dependencies = linkedRepositoryPaths(resolved);
        for (const dependency of dependencies) visit(dependency);
        discovered.push({
            root: resolved,
            packageJson: readPackageJson(resolved),
            dependencies
        });
    };
    visit(root);
    return discovered;
}

function commonAncestor(paths) {
    const split = paths.map((entry) => path.resolve(entry).split(path.sep));
    const common = [];
    for (let index = 0; index < split[0].length; index++) {
        const part = split[0][index];
        if (!split.every((entry) => entry[index] === part)) break;
        common.push(part);
    }
    const result = common.join(path.sep) || path.parse(paths[0]).root;
    return result || path.sep;
}

function gitSourceFiles(repositoryRoot) {
    let output;
    try {
        output = execFileSync(
            "git",
            ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
            { cwd: repositoryRoot, encoding: "buffer" }
        );
    } catch (error) {
        throw new Error(
            `Cannot list source files in ${repositoryRoot}: ${error.message}`
        );
    }
    const ignored = new Set(
        execFileSync(
            "git",
            ["ls-files", "--cached", "--ignored", "--exclude-standard", "-z"],
            { cwd: repositoryRoot, encoding: "buffer" }
        )
            .toString("utf8")
            .split("\0")
            .filter(Boolean)
    );
    const listed = output
        .toString("utf8")
        .split("\0")
        .filter(Boolean)
        .filter((relative) => !ignored.has(relative));
    const files = [];
    for (const relative of listed) {
        const source = path.join(repositoryRoot, relative);
        if (!fs.existsSync(source)) continue;
        if (fs.lstatSync(source).isDirectory()) {
            for (const nested of gitSourceFiles(source)) {
                files.push(path.join(relative, nested));
            }
        } else {
            files.push(relative);
        }
    }
    return files;
}

async function buildRuntimeBundle(
    projectRoot,
    outputFile,
    onProgress = () => {}
) {
    const repositories = discoverRepositories(projectRoot);
    const repositoryRoots = repositories.map((entry) => entry.root);
    let workspaceRoot = commonAncestor(repositoryRoots);
    if (repositoryRoots.includes(workspaceRoot)) {
        workspaceRoot = path.dirname(workspaceRoot);
    }
    const files = [];
    const sourceFilesManifest = [];
    const repositoryManifest = [];
    let expandedBytes = 0;

    for (const repository of repositories) {
        const repositoryPath = path.relative(workspaceRoot, repository.root);
        if (!repositoryPath || repositoryPath.startsWith("..")) {
            throw new Error(
                "Source workspace cannot preserve repository paths safely"
            );
        }
        const sourceFiles = gitSourceFiles(repository.root);
        for (const relative of sourceFiles) {
            const source = path.join(repository.root, relative);
            const stat = fs.lstatSync(source);
            if (!stat.isFile()) {
                throw new Error(
                    `Source package contains unsupported link: ${source}`
                );
            }
            expandedBytes += stat.size;
            const workspacePath = path
                .join(repositoryPath, relative)
                .split(path.sep)
                .join("/");
            files.push(workspacePath);
            sourceFilesManifest.push({
                path: workspacePath,
                bytes: stat.size,
                sha256: await sha256File(source),
                mode: stat.mode & 0o777
            });
        }
        const prepareScript =
            repository.packageJson.peer3TestDistribution?.prepareScript ||
            (repository.packageJson.scripts?.compile ? "compile" : null);
        repositoryManifest.push({
            path: repositoryPath.split(path.sep).join("/"),
            name: repository.packageJson.name || path.basename(repository.root),
            prepareScript,
            hasPnpmLock: sourceFiles.includes("pnpm-lock.yaml"),
            hasYarnLock: sourceFiles.includes("yarn.lock")
        });
    }

    files.sort();
    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    onProgress(
        `Packaging ${files.length} source file(s) from ${repositories.length} repository(s)`
    );
    await tar.c(
        {
            cwd: workspaceRoot,
            file: outputFile,
            gzip: true,
            portable: true,
            follow: false
        },
        files
    );
    const archiveBytes = fs.statSync(outputFile).size;
    const rootProjectPath = path
        .relative(workspaceRoot, fs.realpathSync(projectRoot))
        .split(path.sep)
        .join("/");
    const runnerRepository = repositoryManifest.find((repository) =>
        files.includes(
            `${repository.path}/scripts/e2e-parallel/distributed/worker.js`
        )
    );
    if (!runnerRepository)
        throw new Error("Distributed worker source is missing");
    sourceFilesManifest.sort((left, right) =>
        left.path.localeCompare(right.path)
    );
    const runnerEntry = `${runnerRepository.path}/scripts/e2e-parallel/distributed/worker.js`;
    const workspaceId = crypto
        .createHash("sha256")
        .update(
            JSON.stringify({
                rootProjectPath,
                runnerEntry,
                repositories: repositoryManifest.map(({ path, name }) => ({
                    path,
                    name
                }))
            })
        )
        .digest("hex");
    const sourceDigest = crypto
        .createHash("sha256")
        .update(JSON.stringify(sourceFilesManifest))
        .digest("hex");
    const manifest = {
        version: 3,
        packageManager: "pnpm",
        workspaceId,
        sourceDigest,
        rootProjectPath,
        runnerEntry,
        repositories: repositoryManifest,
        files: sourceFilesManifest,
        fileCount: files.length,
        expandedBytes,
        archiveBytes,
        archiveSha256: await sha256File(outputFile)
    };
    Object.defineProperty(manifest, "localWorkspaceRoot", {
        value: workspaceRoot,
        enumerable: false
    });
    return manifest;
}

async function buildDeltaBundle(manifest, relativeFiles, outputFile) {
    if (!manifest.localWorkspaceRoot) {
        throw new Error("Source manifest is missing its local workspace root");
    }
    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    fs.rmSync(outputFile, { force: true });
    if (relativeFiles.length) {
        await tar.c(
            {
                cwd: manifest.localWorkspaceRoot,
                file: outputFile,
                gzip: true,
                portable: true,
                follow: false
            },
            relativeFiles
        );
    } else {
        await tar.c(
            {
                cwd: manifest.localWorkspaceRoot,
                file: outputFile,
                gzip: true,
                portable: true,
                follow: false,
                filter(entryPath) {
                    return entryPath === ".";
                }
            },
            ["."]
        );
    }
    const selected = new Set(relativeFiles);
    const files = manifest.files.filter((entry) => selected.has(entry.path));
    return {
        fileCount: files.length,
        expandedBytes: files.reduce((sum, entry) => sum + entry.bytes, 0),
        archiveBytes: fs.statSync(outputFile).size,
        archiveSha256: await sha256File(outputFile)
    };
}

module.exports = {
    linkedRepositoryPaths,
    discoverRepositories,
    gitSourceFiles,
    buildRuntimeBundle,
    buildDeltaBundle
};
