import { expect } from "chai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { resolveOrDeployShared } from "@test/harness/core/deploymentCache";
import { createLogger } from "@/utils";

function createTempCacheDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "deploy-cache-"));
}

const logger = createLogger({}, {}, { level: "error" });

describe("resolveOrDeployShared (component)", function () {
    it("deploys once and serves every later caller from the marker", async function () {
        const cacheDir = createTempCacheDir();
        let deployCount = 0;
        const run = () =>
            resolveOrDeployShared({
                cacheDir,
                markerName: "thing.addr",
                validate: async (stored) => stored.startsWith("0x"),
                deploy: async () => {
                    deployCount += 1;
                    return "0xabc";
                },
                logger
            });

        const first = await run();
        const second = await run();
        const third = await run();

        expect(first).to.deep.equal({ value: "0xabc", source: "deployed" });
        expect(second).to.deep.equal({ value: "0xabc", source: "cache" });
        expect(third).to.deep.equal({ value: "0xabc", source: "cache" });
        expect(deployCount).to.equal(1);
    });

    it("gives concurrent first callers a usable value each, then caches for the rest", async function () {
        const cacheDir = createTempCacheDir();
        let deployCount = 0;
        const run = () =>
            resolveOrDeployShared({
                cacheDir,
                markerName: "race.addr",
                validate: async (stored) => stored.startsWith("0x"),
                deploy: async () => {
                    deployCount += 1;
                    await new Promise((resolve) => setTimeout(resolve, 200));
                    // A distinct address per deployment, like a real deploy.
                    return `0xrace${deployCount}`;
                },
                logger
            });

        const concurrent = await Promise.all([run(), run(), run()]);

        // Concurrent first callers may each deploy (they run at the same time
        // and would otherwise wait just as long) — every caller still gets a
        // real deployed value, and nothing is corrupted.
        expect(deployCount).to.be.greaterThan(0);
        for (const entry of concurrent) {
            expect(entry.value.startsWith("0xrace")).to.equal(true);
            expect(entry.source).to.equal("deployed");
        }
        // Whichever landed last is published, and later callers reuse it.
        const published = fs
            .readFileSync(path.join(cacheDir, "race.addr"), "utf8")
            .trim();
        const later = await run();
        expect(later).to.deep.equal({ value: published, source: "cache" });
    });

    it("redeploys when the stored value no longer validates", async function () {
        const cacheDir = createTempCacheDir();
        fs.writeFileSync(path.join(cacheDir, "stale.addr"), "not-an-address");
        let deployCount = 0;

        const result = await resolveOrDeployShared({
            cacheDir,
            markerName: "stale.addr",
            // e.g. the node was wiped, so the stored address has no code.
            validate: async (stored) => stored.startsWith("0x"),
            deploy: async () => {
                deployCount += 1;
                return "0x123";
            },
            logger
        });

        expect(result).to.deep.equal({ value: "0x123", source: "deployed" });
        expect(deployCount).to.equal(1);
        // The fresh value replaced the stale marker.
        expect(
            fs.readFileSync(path.join(cacheDir, "stale.addr"), "utf8")
        ).to.equal("0x123");
    });

    it("deploys directly when no cache dir is configured", async function () {
        const result = await resolveOrDeployShared({
            cacheDir: undefined,
            markerName: "ignored.addr",
            validate: async () => true,
            deploy: async () => "0x789",
            logger
        });
        expect(result).to.deep.equal({ value: "0x789", source: "deployed" });
    });
});
