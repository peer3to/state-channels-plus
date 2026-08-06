const path = require("path");

function assertContained(root, candidate, options = {}) {
    const resolvedRoot = path.resolve(root);
    const resolved = path.resolve(candidate);
    const contained =
        resolved === resolvedRoot ||
        resolved.startsWith(resolvedRoot + path.sep);
    if (!contained || (!options.allowRoot && resolved === resolvedRoot)) {
        throw new Error(options.message || "Path leaves its allowed root");
    }
    return resolved;
}

module.exports = { assertContained };
