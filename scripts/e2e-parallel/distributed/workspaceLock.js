const fs = require("fs");
const path = require("path");
const { acquireOsFileLock } = require("./hostLock");
const { workspacePaths } = require("./workspaceCache");

function acquireWorkspaceLock(workRoot, environmentKey) {
    const workspace = workspacePaths(workRoot, environmentKey);
    fs.mkdirSync(workspace.root, { recursive: true });
    return acquireOsFileLock(
        path.join(workspace.root, "workspace"),
        `Environment ${environmentKey} is already owned by another worker server`
    );
}

module.exports = { acquireWorkspaceLock };
