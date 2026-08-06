const fs = require("fs");
const path = require("path");
const tar = require("tar");
const { sha256File } = require("../shared/fileHash");
const { assertContained } = require("../shared/paths");

function assertCompatible(manifest) {
    if (manifest.version !== 3 || manifest.packageManager !== "pnpm") {
        throw new Error("Unsupported source workspace format");
    }
}

async function extractRuntimeBundle(
    archivePath,
    destination,
    manifest,
    limits,
    expectedFiles = []
) {
    assertCompatible(manifest);
    if (
        manifest.archiveBytes > limits.maxCompressedBytes ||
        manifest.expandedBytes > limits.maxExpandedBytes
    ) {
        throw new Error("Source workspace exceeds worker limits");
    }
    if ((await sha256File(archivePath)) !== manifest.archiveSha256) {
        throw new Error("Source archive checksum mismatch");
    }
    const seen = new Set();
    let fileCount = 0;
    let expandedBytes = 0;
    await tar.t({
        file: archivePath,
        onentry(entry) {
            const normalized = path.posix
                .normalize(entry.path)
                .replace(/^\.\//, "");
            if (!normalized || normalized === ".") return;
            if (
                path.posix.isAbsolute(normalized) ||
                normalized === ".." ||
                normalized.startsWith("../")
            ) {
                throw new Error(`Unsafe archive path: ${entry.path}`);
            }
            if (seen.has(normalized)) {
                throw new Error(`Duplicate archive path: ${normalized}`);
            }
            seen.add(normalized);
            if (!["File", "Directory"].includes(entry.type)) {
                throw new Error(`Unsupported archive entry: ${entry.type}`);
            }
            if (entry.type === "File") {
                fileCount += 1;
                expandedBytes += entry.size;
            }
        }
    });
    if (
        fileCount !== manifest.fileCount ||
        expandedBytes !== manifest.expandedBytes
    ) {
        throw new Error("Source archive does not match its manifest");
    }
    fs.mkdirSync(destination, { recursive: true });
    await tar.x({
        file: archivePath,
        cwd: destination,
        preservePaths: false,
        strict: true
    });
    for (const expected of expectedFiles) {
        const filePath = assertContained(
            destination,
            path.resolve(destination, expected.path),
            { message: `Source file escapes workspace: ${expected.path}` }
        );
        const stat = fs.statSync(filePath);
        if (
            !stat.isFile() ||
            stat.size !== expected.bytes ||
            (stat.mode & 0o777) !== expected.mode ||
            (await sha256File(filePath)) !== expected.sha256
        ) {
            throw new Error(
                `Source file verification failed: ${expected.path}`
            );
        }
    }
    for (const repository of manifest.repositories) {
        const resolved = assertContained(
            destination,
            path.resolve(destination, repository.path),
            { message: "Repository path escapes workspace" }
        );
        if (!fs.existsSync(path.join(resolved, "package.json"))) {
            throw new Error(`Repository is incomplete: ${repository.path}`);
        }
    }
}

module.exports = { assertCompatible, extractRuntimeBundle };
