const fs = require("fs");
const path = require("path");
const { globSync } = require("glob");
const { DEFAULT_FORGE_THREADS } = require("./constants");
const { escapeRegex, sanitizeFileName } = require("./taskDiscovery");
const { TASK_RUNNERS } = require("./taskRunners");

// Foundry test contracts are not confined to `*.t.sol` in this repo, so the
// glob has to cover every Solidity file under the test tree.
const DEFAULT_FORGE_TEST_PATTERN = "**/*.sol";

// The Hardhat task that shells out to forge. Keep in sync with the task name
// registered in tasks/forgeTest.ts.
const FORGE_TEST_TASK = "forge-test";

// Vendored sources and build output are never our test contracts.
const IGNORED_FORGE_DIRS = [
    "**/lib/**",
    "**/out/**",
    "**/node_modules/**",
    "**/cache_forge/**"
];

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
function parseContractDeclarations(source) {
    const declarations = new Map();
    for (const match of source.matchAll(CONTRACT_DECLARATION)) {
        const openIndex = match.index + match[0].length - 1;
        declarations.set(match[2], {
            name: match[2],
            isAbstract: Boolean(match[1]),
            bases: parseBaseNames(match[3]),
            declaresTest: TEST_FUNCTION.test(blockBody(source, openIndex))
        });
    }
    return declarations;
}

/**
 * Whether a contract owns a test function, directly or through a base declared
 * in the same file. Resolution stops at the file boundary — an imported base is
 * invisible here — and `seen` guards against a malformed cyclic `is` clause.
 */
function inheritsTestFunction(declaration, declarations, seen = new Set()) {
    if (!declaration || seen.has(declaration.name)) return false;
    seen.add(declaration.name);
    if (declaration.declaresTest) return true;
    return declaration.bases.some((base) =>
        inheritsTestFunction(declarations.get(base), declarations, seen)
    );
}

/**
 * A contract is a forge test contract iff it declares — or inherits from a base
 * in the same file — at least one test function. Selecting by base class is
 * unreliable (bases in this repo are both `Test` and `DiamondHarness`), and
 * harness/helper contracts share files with real test contracts. Abstract
 * contracts are never run by forge, but their test functions still make every
 * concrete contract that extends them a test contract.
 */
function extractForgeTestContracts(filePath) {
    const source = stripSolidityNoise(fs.readFileSync(filePath, "utf8"));
    const declarations = parseContractDeclarations(source);
    return [...declarations.values()]
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
        ignore: IGNORED_FORGE_DIRS
    }).sort();
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
    if (grep) {
        const matcher = new RegExp(grep);
        tasks = tasks.filter((task) => matcher.test(task.fullTitle));
    }
    return { files, tasks };
}

module.exports = {
    DEFAULT_FORGE_TEST_PATTERN,
    FORGE_TEST_TASK,
    stripSolidityNoise,
    extractForgeTestContracts,
    discoverForgeTasks
};
