const fs = require("fs");
const path = require("path");
const { acquireOsFileLock } = require("./hostLock");
const { workspacePaths } = require("./workspaceCache");

function acquireWorkspaceLock(workRoot, environmentKey) {
    const workspace = workspacePaths(workRoot, environmentKey);
    fs.mkdirSync(workspace.root, { recursive: true });
    return acquireOsFileLock(
        path.join(workspace.root, "workspace.lock"),
        `Environment ${environmentKey} under work root ${path.resolve(workRoot)} is already owned by another worker server; every worker on a shared host needs a different --work-root`
    );
}

module.exports = { acquireWorkspaceLock };
