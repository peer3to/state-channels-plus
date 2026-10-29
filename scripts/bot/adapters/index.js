const { ClaudeAdapter } = require("./claude");
const { CodexAdapter } = require("./codex");
// One owner for choosing the native review provider.
// A null workspace (native cleanup) never starts a model turn.
function createAdapter(config, tools, workspace = null) {
    return config.provider === "claude"
        ? new ClaudeAdapter(config, tools, workspace)
        : new CodexAdapter(config, tools, workspace);
}
module.exports = { createAdapter };
