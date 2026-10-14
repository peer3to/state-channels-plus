const fs = require("node:fs");
const os = require("node:os");

/**
 * The OS temp folder with symlinks resolved. The service resolves the roots it
 * works in (macOS: /var → /private/var), so fixtures that compare or intercept
 * paths under a temp root must start from the resolved folder.
 */
function realTmpdir() {
    return fs.realpathSync(os.tmpdir());
}
module.exports = { realTmpdir };
