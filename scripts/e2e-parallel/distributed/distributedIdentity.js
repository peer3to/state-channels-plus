/* eslint-disable no-console */
const path = require("path");
const { loadOrchestratorKeyPair } = require("./orchestratorIdentity");

function usage() {
    return `Usage: yarn distributed:identity [options]

Options:
  --state-dir PATH  Persistent orchestrator identity directory
  -h, --help        Show this help`;
}

function parseIdentityArgs(argv) {
    const options = {
        stateDir: path.resolve("temp", "distributed-orchestrator")
    };
    for (let index = 2; index < argv.length; index++) {
        const argument = argv[index];
        if (argument === "--help" || argument === "-h") {
            return { help: true };
        }
        const [flag, inline] = argument.split(/=(.*)/s);
        if (flag !== "--state-dir") {
            throw new Error(`Unknown distributed identity option: ${flag}`);
        }
        const value = inline === undefined ? argv[++index] : inline;
        if (!value || value.startsWith("--")) {
            throw new Error("--state-dir requires a value");
        }
        options.stateDir = path.resolve(value);
    }
    return options;
}

function main(argv = process.argv) {
    const options = parseIdentityArgs(argv);
    if (options.help) {
        console.log(usage());
        return;
    }
    const keyPair = loadOrchestratorKeyPair(options.stateDir);
    console.log(keyPair.publicKey.toString("hex"));
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}

module.exports = { main, parseIdentityArgs, usage };
