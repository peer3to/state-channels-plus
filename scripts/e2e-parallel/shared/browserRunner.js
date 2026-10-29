const { runTierProcess } = require("./tierProcess");

/** A browser gate is a plain Node entry point: `node <gate>.mjs`. */
function runBrowserGate(scriptPath, cwd, options = {}) {
    return runTierProcess(process.execPath, [scriptPath], cwd, {
        ...options,
        describe: `node ${scriptPath}`
    });
}

module.exports = { runBrowserGate };
