const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const { gitFixture } = require("./git");
const { reviewWorker } = require("./review-worker");

async function waitForFile(file) {
    const deadline = Date.now() + 10000;
    while (true) {
        try {
            return JSON.parse(await fs.readFile(file, "utf8"));
        } catch (error) {
            if (error.code !== "ENOENT") throw error;
        }
        if (Date.now() > deadline)
            throw new Error(`Missing provider event ${file}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}
async function executionFixture(body) {
    await gitFixture(async (tree) => {
        await reviewWorker(async (fixture) => {
            const service = fixture.worker.review;
            service.config.codexPath = path.join(__dirname, "native-peer.js");
            service.worktrees.origins = tree.owner.origins;
            const input = {
                ...tree.input,
                caller: fixture.keyPair.publicKey.toString("hex"),
                botRevision: service.botRevision,
                skillDigest: service.skillDigest,
                policyDigest: service.policyDigest
            };
            const originalFetch = global.fetch;
            // Only the external GitHub boundary is recorded; all readers remain real.
            global.fetch = async (url) => {
                const parsed = new URL(url);
                assert.equal(parsed.hostname, "api.github.com");
                assert.ok(parsed.pathname.startsWith("/repos/owner/repo/"));
                const pr = Number(
                    parsed.pathname.match(/\/(?:pulls|issues)\/(\d+)/)?.[1]
                );
                const data = /\/pulls\/\d+$/.test(parsed.pathname)
                    ? { ...tree.pull, number: pr }
                    : [];
                return new Response(JSON.stringify(data), {
                    headers: { "content-type": "application/json" }
                });
            };
            try {
                await body({ ...fixture, tree, service, input });
            } finally {
                global.fetch = originalFetch;
            }
        });
    });
}
module.exports = { executionFixture, waitForFile };
