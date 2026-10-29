const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { writeJson } = require("../../data");
const { failure } = require("../../protocol");
const { request } = require("../fixtures/records");
describe("review disk-full handling", function () {
    it("reports an actual ENOSPC from registry persistence without deleting existing data", async function () {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "review-disk-"));
        await writeJson(root, "registry.json", { preserved: true });
        const original = fs.writeFile;
        try {
            // Luka explicitly allows mocking only the failing filesystem operation.
            fs.writeFile = async () => {
                const error = new Error(
                    "No space left on device at a private host path"
                );
                error.code = "ENOSPC";
                throw error;
            };
            let caught;
            try {
                await writeJson(root, "registry.json", { preserved: false });
            } catch (error) {
                caught = error;
            }
            assert.equal(caught.code, "DISK_FULL");
            assert.equal(caught.message, "Disk is full.");
            assert.equal(failure(caught, request()).message, "Disk is full.");
            assert.deepEqual(
                JSON.parse(
                    await fs.readFile(path.join(root, "registry.json"), "utf8")
                ),
                { preserved: true }
            );
            assert.deepEqual(await fs.readdir(root), ["registry.json"]);
        } finally {
            fs.writeFile = original;
            await fs.rm(root, { recursive: true });
        }
    });
    it("does not report success when atomic replacement itself runs out of space", async function () {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "review-disk-"));
        const original = fs.rename;
        try {
            fs.rename = async () => {
                const error = new Error("No space left");
                error.code = "ENOSPC";
                throw error;
            };
            await assert.rejects(
                writeJson(root, "result.json", { success: true }),
                { code: "DISK_FULL", message: "Disk is full." }
            );
            assert.deepEqual(await fs.readdir(root), []);
        } finally {
            fs.rename = original;
            await fs.rm(root, { recursive: true });
        }
    });
    it("propagates worktree creation ENOSPC without deleting the owned clone or siblings", async function () {
        const { gitFixture } = require("../fixtures/git");
        await gitFixture(async ({ owner, input, pull, root }) => {
            const sentinel = path.join(root, "sentinel");
            await fs.writeFile(sentinel, "keep");
            const original = fs.mkdir;
            try {
                fs.mkdir = async (directory, ...args) => {
                    if (String(directory).endsWith("repo-1.git")) {
                        const error = new Error("No space left");
                        error.code = "ENOSPC";
                        throw error;
                    }
                    return original(directory, ...args);
                };
                await assert.rejects(owner.prepare(input, pull), {
                    code: "DISK_FULL",
                    message: "Disk is full."
                });
                assert.equal(await fs.readFile(sentinel, "utf8"), "keep");
            } finally {
                fs.mkdir = original;
            }
        });
    });
    it("rejects session delivery when both the result and failure status cannot be persisted", async function () {
        const { Sessions } = require("../../sessions");
        const { DEFAULTS } = require("../../config");
        const { digest } = require("../../data");
        const { result } = require("../fixtures/records");
        const root = await fs.mkdtemp(
            path.join(os.tmpdir(), "review-session-disk-")
        );
        const sessions = new Sessions(root, DEFAULTS);
        await sessions.initialize();
        const original = fs.rename;
        try {
            fs.rename = async (...args) => {
                if (String(args[1]).includes("/attempts/")) {
                    const error = new Error("No space left");
                    error.code = "ENOSPC";
                    throw error;
                }
                return original(...args);
            };
            const input = request();
            await assert.rejects(
                sessions.submit(
                    input,
                    digest("context"),
                    async () => result(input),
                    async () => true
                ),
                { code: "DISK_FULL" }
            );
            assert.deepEqual(await fs.readdir(path.join(root, "attempts")), []);
            assert.equal(sessions.failures[0].code, "DISK_FULL");
        } finally {
            fs.rename = original;
            await sessions.close();
            await fs.rm(root, { recursive: true });
        }
    });
});
