const fs = require("fs");
const path = require("path");
const { globSync } = require("glob");
const { DEFAULT_FORGE_THREADS, FORGE_TEST_TASK } = require("./forgeConfig");
const { escapeRegex, sanitizeFileName } = require("./taskDiscovery");
const { TASK_RUNNERS } = require("./taskRunners");

// Foundry does not confine test contracts to `*.t.sol`, so the glob has to
// cover every Solidity file under the test tree.
const DEFAULT_FORGE_TEST_PATTERN = "**/*.sol";

// Vendored sources and build output are never our test contracts.
const IGNORED_FORGE_DIRS = [
    "**/lib/**",
    "**/out/**",
    "**/node_modules/**",
    "**/cache_forge/**"
];

function isFile(filePath) {
    try {
        return fs.statSync(filePath).isFile();
    } catch {
        return false;
    }
}

function isForgeTestFile(filePath) {
    return path.extname(filePath) === ".sol";
}

// Captures the `abstract` modifier, the contract name, the inheritance list
// (everything between `is` and the opening brace), and the brace itself.
const CONTRACT_DECLARATION =
    /(\babstract\s+)?\bcontract\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:\bis\b([^{]*))?\{/g;

// forge runs every function whose name starts with `test` (testFuzz included),
// `invariant`, or `statefulFuzz`.
const TEST_FUNCTION =
    /\bfunction\s+(?:test|invariant|statefulFuzz)[A-Za-z0-9_$]*\s*\(/;

/**
 * Drop comments and string literals so a declaration quoted inside one can't be
 * mistaken for real source.
 */
function stripSolidityNoise(source) {
    let out = "";
    let index = 0;
    while (index < source.length) {
        const char = source[index];
        const pair = source.slice(index, index + 2);
        if (pair === "//") {
            const end = source.indexOf("\n", index);
            index = end === -1 ? source.length : end;
            continue;
        }
        if (pair === "/*") {
            const end = source.indexOf("*/", index + 2);
            index = end === -1 ? source.length : end + 2;
            out += " ";
            continue;
        }
        if (char === '"' || char === "'") {
            index++;
            while (index < source.length && source[index] !== char) {
                index += source[index] === "\\" ? 2 : 1;
            }
            index++;
            out += '""';
            continue;
        }
        out += char;
        index++;
    }
    return out;
}

/** Drop comments while preserving import string literals. */
function stripSolidityComments(source) {
    let out = "";
    let index = 0;
    while (index < source.length) {
        const pair = source.slice(index, index + 2);
        if (pair === "//") {
            const end = source.indexOf("\n", index);
            index = end === -1 ? source.length : end;
            out += "\n";
            continue;
        }
        if (pair === "/*") {
            const end = source.indexOf("*/", index + 2);
            const removed = source.slice(
                index,
                end === -1 ? source.length : end + 2
            );
            out += removed.replace(/[^\n]/g, " ");
            index = end === -1 ? source.length : end + 2;
            continue;
        }
        const char = source[index];
        if (char === '"' || char === "'") {
            const quote = char;
            out += char;
            index++;
            while (index < source.length) {
                out += source[index];
                if (source[index] === "\\") {
                    index++;
                    if (index < source.length) out += source[index];
                } else if (source[index] === quote) {
                    index++;
                    break;
                }
                index++;
            }
            continue;
        }
        out += char;
        index++;
    }
    return out;
}

/** Body of the block that opens at `openIndex`, without the braces. */
function blockBody(source, openIndex) {
    let depth = 0;
    for (let index = openIndex; index < source.length; index++) {
        if (source[index] === "{") depth++;
        else if (source[index] === "}") {
            depth--;
            if (depth === 0) return source.slice(openIndex + 1, index);
        }
    }
    return source.slice(openIndex + 1);
}

/** Base contract names in an `is A, B(arg)` clause, constructor args dropped. */
function parseBaseNames(clause) {
    if (!clause) return [];
    return clause
        .replace(/\([^)]*\)/g, " ")
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean);
}

/** Every contract declared in one file, in source order, keyed by name. */
function parseContractDeclarations(source, filePath) {
    const declarations = new Map();
    for (const match of source.matchAll(CONTRACT_DECLARATION)) {
        const openIndex = match.index + match[0].length - 1;
        declarations.set(match[2], {
            name: match[2],
            id: `${filePath}:${match[2]}`,
            isAbstract: Boolean(match[1]),
            bases: parseBaseNames(match[3]),
            declaresTest: TEST_FUNCTION.test(blockBody(source, openIndex))
        });
    }
    return declarations;
}

function findProjectRoot(filePath) {
    let current = path.dirname(path.resolve(filePath));
    while (true) {
        if (fs.existsSync(path.join(current, "foundry.toml"))) return current;
        const parent = path.dirname(current);
        if (parent === current) return undefined;
        current = parent;
    }
}

function foundryRemappings(projectRoot) {
    if (!projectRoot) return [];
    const source = fs.readFileSync(
        path.join(projectRoot, "foundry.toml"),
        "utf8"
    );
    const remappings = source.match(/remappings\s*=\s*\[([\s\S]*?)\]/)?.[1];
    if (!remappings) return [];
    return [...remappings.matchAll(/["']([^"'=]+)=([^"']+)["']/g)].map(
        ([, prefix, target]) => ({ prefix, target })
    );
}

function resolveImportPath(importPath, importingFile, projectRoot, remappings) {
    if (importPath.startsWith(".")) {
        return path.resolve(path.dirname(importingFile), importPath);
    }
    for (const { prefix, target } of remappings) {
        if (importPath.startsWith(prefix)) {
            return path.resolve(
                projectRoot,
                target,
                importPath.slice(prefix.length)
            );
        }
    }
    return projectRoot ? path.resolve(projectRoot, importPath) : undefined;
}

function parseImports(source) {
    const imports = [];
    const clean = stripSolidityComments(source);
    const pattern =
        /\bimport\s+(?:\{([^}]*)\}\s+from\s+)?["']([^"']+)["']\s*;/g;
    for (const match of clean.matchAll(pattern)) {
        const names = match[1]
            ? match[1].split(",").map((entry) => {
                  const [imported, local] = entry.trim().split(/\s+as\s+/);
                  return { imported, local: local || imported };
              })
            : null;
        imports.push({ names, source: match[2] });
    }
    return imports;
}

function declarationScope(filePath, cache = new Map(), loading = new Set()) {
    const absolute = path.resolve(filePath);
    if (cache.has(absolute)) return cache.get(absolute);
    if (loading.has(absolute) || !isFile(absolute)) return new Map();
    loading.add(absolute);

    const rawSource = fs.readFileSync(absolute, "utf8");
    const own = parseContractDeclarations(
        stripSolidityNoise(rawSource),
        absolute
    );
    const scope = new Map(own);
    const projectRoot = findProjectRoot(absolute);
    const remappings = foundryRemappings(projectRoot);
    for (const imported of parseImports(rawSource)) {
        const importedPath = resolveImportPath(
            imported.source,
            absolute,
            projectRoot,
            remappings
        );
        if (!importedPath || !isFile(importedPath)) continue;
        const importedScope = declarationScope(importedPath, cache, loading);
        if (!imported.names) {
            for (const [name, declaration] of importedScope) {
                if (!scope.has(name)) scope.set(name, declaration);
            }
            continue;
        }
        for (const { imported: importedName, local } of imported.names) {
            const declaration = importedScope.get(importedName);
            if (declaration) scope.set(local, declaration);
        }
    }
    loading.delete(absolute);
    cache.set(absolute, scope);
    return scope;
}

/**
 * Whether a contract owns a test function, directly or through a visible base.
 * Imported declarations are part of the scope, and `seen` guards against a
 * malformed cyclic `is` clause.
 */
function inheritsTestFunction(declaration, declarations, seen = new Set()) {
    if (!declaration || seen.has(declaration.id)) return false;
    seen.add(declaration.id);
    if (declaration.declaresTest) return true;
    return declaration.bases.some((base) =>
        inheritsTestFunction(declarations.get(base), declarations, seen)
    );
}

/**
 * A contract is a forge test contract iff it declares or inherits at least one
 * test function. Selecting by base class is
 * unreliable (bases in this repo are both `Test` and `DiamondHarness`), and
 * harness/helper contracts share files with real test contracts. Abstract
 * contracts are never run by forge, but their test functions still make every
 * concrete contract that extends them a test contract.
 */
function extractForgeTestContracts(filePath) {
    const source = stripSolidityNoise(fs.readFileSync(filePath, "utf8"));
    const ownDeclarations = parseContractDeclarations(source, filePath);
    const declarations = declarationScope(filePath);
    return [...ownDeclarations.values()]
        .filter(
            (declaration) =>
                !declaration.isAbstract &&
                inheritsTestFunction(declaration, declarations)
        )
        .map((declaration) => declaration.name);
}

/**
 * `--match-contract` matches contract names project-wide, so two test contracts
 * sharing a name (legal Solidity across files) would produce two tasks that each
 * run both contracts, and their log file names would collide. Fail discovery
 * instead of scheduling that silently.
 */
function assertUniqueContractNames(discovered) {
    const filesByContract = new Map();
    for (const { file, contract } of discovered) {
        if (!filesByContract.has(contract)) filesByContract.set(contract, []);
        filesByContract.get(contract).push(file);
    }
    const duplicates = [...filesByContract.entries()]
        .filter(([, files]) => files.length > 1)
        .map(([contract, files]) => `${contract} (${files.join(", ")})`);
    if (duplicates.length > 0) {
        throw new Error(
            `Duplicate Foundry test contract name(s): ${duplicates.join("; ")}. ` +
                "forge --match-contract matches contract names project-wide, so " +
                "each task would run every same-named contract and their log " +
                "files would overwrite each other. Rename one of them."
        );
    }
}

/**
 * One task per Foundry test contract — forge already parallelizes the test
 * functions inside a contract, so a task per function is too fine. Discovery is
 * static (no forge invocation) because it runs on the orchestrator, where a
 * via_ir build would be far too slow. `grep` filters on the contract name, the
 * forge equivalent of a Mocha full title.
 *
 * The arguments are Hardhat CLI arguments for the `forge-test` task in
 * tasks/forgeTest.ts, not forge arguments: every task is spawned through the
 * Hardhat CLI, and hardhat.config.ts is a synced project source while the
 * runner on a distributed worker is not.
 */
function discoverForgeTasks(testDir, grep, options = {}) {
    const {
        threads = DEFAULT_FORGE_THREADS,
        testPattern = DEFAULT_FORGE_TEST_PATTERN
    } = options;
    if (!Number.isInteger(threads) || threads < 1) {
        throw new Error(
            `forge thread count must be a positive integer, got ${JSON.stringify(threads)}`
        );
    }
    const files = globSync(path.join(testDir, testPattern), {
        ignore: IGNORED_FORGE_DIRS,
        nodir: true
    })
        .filter(isForgeTestFile)
        .sort();
    const discovered = files.flatMap((file) =>
        extractForgeTestContracts(file).map((contract) => ({ file, contract }))
    );
    assertUniqueContractNames(discovered);
    let tasks = discovered.map(({ file, contract }) => ({
        label: `forge:${path.basename(file)}:${contract}`,
        args: [
            FORGE_TEST_TASK,
            "--match-contract",
            `^${escapeRegex(contract)}$`,
            "--threads",
            String(threads)
        ],
        logName: sanitizeFileName(
            `${path.basename(file, path.extname(file))}__${contract}`
        ),
        fullTitle: contract,
        runner: TASK_RUNNERS.FORGE,
        isE2E: false
    }));
    const preGrepTaskCount = tasks.length;
    if (grep) {
        const matcher = new RegExp(grep);
        tasks = tasks.filter((task) => matcher.test(task.fullTitle));
    }
    return { files, tasks, preGrepTaskCount };
}

module.exports = {
    DEFAULT_FORGE_TEST_PATTERN,
    FORGE_TEST_TASK,
    stripSolidityNoise,
    extractForgeTestContracts,
    discoverForgeTasks
};
