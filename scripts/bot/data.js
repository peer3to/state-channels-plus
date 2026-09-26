const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { ReviewError, sanitized } = require("./errors");
function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.keys(value)
                .sort()
                .map((key) => [key, canonical(value[key])])
        );
    }
    return value;
}
function digest(value) {
    return crypto
        .createHash("sha256")
        .update(
            typeof value === "string" || Buffer.isBuffer(value)
                ? value
                : JSON.stringify(canonical(value))
        )
        .digest("hex");
}
function exact(value, keys, code = "INVALID_REQUEST") {
    if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        Object.keys(value).some((key) => !keys.includes(key))
    )
        throw new ReviewError(code);
}
function check(value, code = "INVALID_REQUEST") {
    if (!value) throw new ReviewError(code);
}
async function ownedPath(root, relative, allowMissing = false) {
    check(
        typeof relative === "string" &&
            relative.length > 0 &&
            !path.isAbsolute(relative)
    );
    const parts = relative.split(/[\\/]/);
    check(parts.every((part) => part && part !== "." && part !== ".."));
    const base = await fs.realpath(root);
    let current = base;
    for (const part of parts) {
        current = path.join(current, part);
        try {
            const stat = await fs.lstat(current);
            check(!stat.isSymbolicLink());
        } catch (error) {
            if (!allowMissing || error.code !== "ENOENT") throw error;
        }
    }
    return current;
}
async function writeText(root, relative, text) {
    check(typeof text === "string");
    const file = await ownedPath(root, relative, true);
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    try {
        await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
        await fs.writeFile(temporary, text, { flag: "wx", mode: 0o600 });
        await fs.rename(temporary, file);
    } catch (error) {
        await fs.rm(temporary, { force: true }).catch(() => {});
        throw sanitized(error);
    }
}
async function writeJson(root, relative, value) {
    return writeText(root, relative, JSON.stringify(value, null, 2) + "\n");
}
module.exports = {
    canonical,
    digest,
    exact,
    check,
    ownedPath,
    writeJson,
    writeText
};
