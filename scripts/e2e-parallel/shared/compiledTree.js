// What the compiled test tree under dist/ is built from, and the stamp the
// build leaves behind so a later run can tell whether the tree is current.
//
// The TypeScript inputs are what TypeScript itself says they are: the
// project's tsconfig.json is read by the project's own TypeScript (JSONC,
// `extends`, include/exclude globs and `files` all apply), and the program
// built from it lists every file the compiler reads, imported dependencies
// outside the include patterns and declaration files included. A change to
// any of them, or to a tsconfig in the `extends` chain, makes the tree stale,
// the same way it would make a normal `tsc` build rerun.
//
// Two kinds of staleness are told apart. A source whose content changed only
// moves its modification time: the tree is refreshed in place (tsc emits over
// the old files; nothing is deleted, because an outer run may be loading from
// the same tree). A source added, removed or renamed changes the file set:
// the tree is rebuilt from scratch, so a twin of a deleted or renamed file
// cannot linger and be run. A file the compiler only reads (a declaration
// file, a dependency's types, a tsconfig in the chain) that is added, removed
// or renamed emits nothing of its own, so it only needs a refresh; its
// set is still tracked, because a deleted or renamed file moves no remaining
// file's modification time.
//
// A project's copy step also mirrors files tsc does not emit (JSON, Solidity,
// .wasm binaries, worker scripts) into dist. Those runtime assets are the
// non-TypeScript files under the top-level directories that hold the
// program's own source files, so a change to any of them makes the tree
// stale too.
const { spawnSync } = require("child_process");
const { createHash } = require("crypto");
const fs = require("fs");
const path = require("path");

const TSCONFIG = "tsconfig.json";
// The copy steps read the manifest (poker writes dist/package.json from it).
const MANIFEST = "package.json";
// Directories never scanned for runtime assets: dependencies, and the
// compiled tree itself (the tsconfig outDir is skipped as well).
const SKIPPED_DIRS = new Set(["node_modules", "dist"]);
// TypeScript files are never runtime assets: the program covers the ones the
// build compiles, and the copy steps do not mirror the others.
const TYPESCRIPT_FILE = /\.(c|m)?tsx?$/;
const STAMP_PATH = path.join("dist", ".test-build-stamp");

/** The TypeScript the project's own build runs. */
function loadTypeScript(root) {
    return require(require.resolve("typescript", { paths: [root, __dirname] }));
}

/**
 * The project's tsconfig.json as its TypeScript reads it, and the program
 * built from it. Throws when the tsconfig cannot be read.
 */
function typeScriptProgram(root) {
    const ts = loadTypeScript(root);
    const parsed = ts.getParsedCommandLineOfConfigFile(
        path.join(root, TSCONFIG),
        undefined,
        {
            ...ts.sys,
            onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
                throw new Error(
                    ts.flattenDiagnosticMessageText(
                        diagnostic.messageText,
                        "\n"
                    )
                );
            }
        }
    );
    const program = ts.createProgram({
        rootNames: parsed.fileNames,
        options: parsed.options,
        projectReferences: parsed.projectReferences
    });
    return { parsed, program };
}

/**
 * Every input of the compiled tree:
 * - `emitted`: the program files tsc compiles into the tree (the file set);
 * - `read`: every other file the compiler reads (declaration files, the
 *   tsconfig chain, the manifest), whose changes only need a refresh;
 * - `assets`: the runtime assets the copy step mirrors (part of the file set).
 */
function compiledTreeInputs(root = process.cwd()) {
    const { parsed, program } = typeScriptProgram(root);
    const emitted = [];
    const read = [
        path.join(root, TSCONFIG),
        ...(parsed.options.configFile?.extendedSourceFiles ?? []),
        path.join(root, MANIFEST)
    ];
    for (const file of program.getSourceFiles()) {
        if (
            file.isDeclarationFile ||
            program.isSourceFileFromExternalLibrary(file)
        ) {
            read.push(file.fileName);
        } else {
            emitted.push(file.fileName);
        }
    }
    const outDir = parsed.options.outDir && path.resolve(parsed.options.outDir);
    const assetDirs = new Set();
    for (const file of emitted) {
        const segments = path.relative(root, file).split(path.sep);
        if (segments.length > 1 && segments[0] !== "..") {
            assetDirs.add(path.join(root, segments[0]));
        }
    }
    const assets = [];
    for (const dir of assetDirs) {
        const stack = [dir];
        while (stack.length) {
            const current = stack.pop();
            let entries;
            try {
                entries = fs.readdirSync(current, { withFileTypes: true });
            } catch {
                continue;
            }
            for (const entry of entries) {
                const file = path.join(current, entry.name);
                if (entry.isDirectory()) {
                    if (!SKIPPED_DIRS.has(entry.name) && file !== outDir) {
                        stack.push(file);
                    }
                } else if (!TYPESCRIPT_FILE.test(entry.name)) {
                    assets.push(file);
                }
            }
        }
    }
    return { emitted, read, assets };
}

function setHash(root, files) {
    const relative = files.map((file) => path.relative(root, file)).sort();
    return {
        count: relative.length,
        hash: createHash("sha256").update(relative.join("\n")).digest("hex")
    };
}

/**
 * The compiled tree's file set hash, the read-only dependency set hash, and
 * the newest mtime of all inputs.
 */
function scanSources(root = process.cwd()) {
    const { emitted, read, assets } = compiledTreeInputs(root);
    const fileSet = setHash(root, [...emitted, ...assets]);
    const readSet = setHash(root, read);
    let newestMtimeMs = 0;
    for (const file of [...emitted, ...assets, ...read]) {
        let stat;
        try {
            stat = fs.statSync(file);
        } catch {
            continue;
        }
        if (stat.mtimeMs > newestMtimeMs) newestMtimeMs = stat.mtimeMs;
    }
    return {
        fileCount: fileSet.count,
        fileSetHash: fileSet.hash,
        readSetHash: readSet.hash,
        newestMtimeMs
    };
}

function readStamp(root = process.cwd()) {
    try {
        const stamp = JSON.parse(
            fs.readFileSync(path.join(root, STAMP_PATH), "utf8")
        );
        return Number.isFinite(stamp.builtAtMs) && stamp.fileSetHash
            ? stamp
            : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Records the tree as built from the current inputs. `builtAtMs` is when the
 * build started reading them, so a source saved during the build still
 * counts as newer than the tree.
 */
function writeStamp(root = process.cwd(), builtAtMs = Date.now()) {
    const { fileCount, fileSetHash, readSetHash } = scanSources(root);
    fs.mkdirSync(path.join(root, "dist"), { recursive: true });
    fs.writeFileSync(
        path.join(root, STAMP_PATH),
        JSON.stringify({ builtAtMs, fileCount, fileSetHash, readSetHash })
    );
}

/**
 * "current" when nothing changed since the stamp, "refresh" when only
 * contents or the read-only dependency set changed (a stamp without that set
 * counts as changed), "rebuild" when the file set changed, no stamp exists,
 * or the tsconfig cannot be read (the build then reports why).
 */
function compiledTreeState(root = process.cwd()) {
    const stamp = readStamp(root);
    if (!stamp) return "rebuild";
    let sources;
    try {
        sources = scanSources(root);
    } catch {
        return "rebuild";
    }
    if (sources.fileSetHash !== stamp.fileSetHash) return "rebuild";
    if (sources.readSetHash !== stamp.readSetHash) return "refresh";
    return sources.newestMtimeMs > stamp.builtAtMs ? "refresh" : "current";
}

const COMPILED_TEST_BUILD_SCRIPT = "test:parallel:build";
// Optional: emits over the existing tree without deleting it. A project
// without it gets a clean build whenever a source changed.
const COMPILED_TEST_REFRESH_SCRIPT = "test:parallel:refresh";

// The build scripts belong to the project under test (the SDK or a consumer
// running this runner from node_modules), never to this file's own
// repository.
function projectScripts(root = process.cwd()) {
    try {
        return (
            JSON.parse(fs.readFileSync(path.join(root, MANIFEST), "utf8"))
                .scripts ?? {}
        );
    } catch {
        return {};
    }
}

function compiledTestTreeAvailable(root = process.cwd()) {
    return (
        !!projectScripts(root)[COMPILED_TEST_BUILD_SCRIPT] &&
        fs.existsSync(path.join(root, TSCONFIG))
    );
}

// Bring the compiled tree up to date with the sources. Changed contents are
// emitted in place when the project has a refresh script; an added, removed
// or renamed source, or a missing stamp, means a clean build so no twin of a
// deleted file can linger. The tree is stamped after either succeeds.
// Returns an error message on failure, undefined otherwise.
function refreshCompiledTestTree(root = process.cwd()) {
    const state = compiledTreeState(root);
    if (state === "current") return undefined;
    const refresh =
        state === "refresh" &&
        !!projectScripts(root)[COMPILED_TEST_REFRESH_SCRIPT];
    const script = refresh
        ? COMPILED_TEST_REFRESH_SCRIPT
        : COMPILED_TEST_BUILD_SCRIPT;
    // eslint-disable-next-line no-console
    console.log(
        state === "rebuild"
            ? "Building the compiled test tree (dist): the source file set changed since the last build..."
            : refresh
              ? "Refreshing the compiled test tree (dist): sources changed since the last build..."
              : "Building the compiled test tree (dist): sources changed since the last build..."
    );
    const startedAtMs = Date.now();
    const result = spawnSync("yarn", ["-s", script], {
        cwd: root,
        stdio: "inherit",
        env: process.env
    });
    if (result.status !== 0)
        return `Building the compiled test tree failed (yarn -s ${script})`;
    writeStamp(root, startedAtMs);
    return undefined;
}

module.exports = {
    compiledTestTreeAvailable,
    compiledTreeInputs,
    compiledTreeState,
    refreshCompiledTestTree,
    scanSources,
    writeStamp,
    STAMP_PATH
};
