const fs = require("fs");

// Keep unchanged generated files' mtimes so they do not invalidate TypeScript builds.
function writeFileIfChanged(file, contents) {
    try {
        if (fs.readFileSync(file, "utf8") === contents) return false;
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
    }
    fs.writeFileSync(file, contents);
    return true;
}

module.exports = { writeFileIfChanged };
