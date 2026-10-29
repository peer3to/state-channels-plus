const { FORGE_BIN } = require("./forgeConfig");
const { runTierProcess } = require("./tierProcess");

function runForge(args, cwd, options = {}) {
    return runTierProcess(FORGE_BIN, args, cwd, options);
}

module.exports = { runForge };
