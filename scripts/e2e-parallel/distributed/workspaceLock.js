const fs = require("fs");
const path = require("path");
const { acquireOsFileLock } = require("./hostLock");
const { workspacePaths } = require("./workspaceCache");

function acquireWorkspaceLock(workRoot, workspaceId) {
    const workspace = workspacePaths(workRoot, workspaceId);
    fs.mkdirSync(workspace.root, { recursive: true });
    return acquireOsFileLock(
        path.join(workspace.root, "workspace.lock"),
        `Workspace ${workspaceId} is already owned by another worker server`
    );
}

module.exports = { acquireWorkspaceLock };
