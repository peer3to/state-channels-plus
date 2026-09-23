const { ClaudeAdapter } = require("./claude");
const { CodexAdapter } = require("./codex");
// One owner for choosing the native review provider.
function createAdapter(config, tools) {
    return config.provider === "claude"
        ? new ClaudeAdapter(config, tools)
        : new CodexAdapter(config, tools);
}
module.exports = { createAdapter };
