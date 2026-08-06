import { expect } from "chai";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const {
    buildRuntimeBundle,
    buildDeltaBundle
} = require("../../scripts/e2e-parallel/distributed/runtimeBundle.js");
const {
    extractRuntimeBundle,
    assertCompatible
} = require("../../scripts/e2e-parallel/distributed/runtimeExtractor.js");

function initializeRepository(root: string): void {
    fs.mkdirSync(root, { recursive: true });
    execFileSync("git", ["init", "--quiet"], { cwd: root });
}

describe("distributed source workspace", function () {
    it("preserves linked repository layout and excludes gitignored files", async function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "source-workspace-")
        );
        const project = path.join(root, "project");
        const linked = path.join(root, "linked");
        const transfer = path.join(root, "transfer", "source.tgz");
        const extracted = path.join(root, "extracted");
        try {
            initializeRepository(project);
            initializeRepository(linked);
            fs.writeFileSync(
                path.join(project, "package.json"),
                JSON.stringify({
                    name: "project",
                    dependencies: { linked: "link:../linked" },
                    scripts: { compile: "true" }
                })
            );
            fs.writeFileSync(
                path.join(project, ".gitignore"),
                ".env\nlogs\nnode_modules\n"
            );
            fs.writeFileSync(
                path.join(project, "index.js"),
                "module.exports = 1;\n"
            );
            fs.writeFileSync(path.join(project, "yarn.lock"), "");
            fs.writeFileSync(path.join(project, ".env"), "SECRET=yes\n");
            fs.mkdirSync(path.join(project, "logs"));
            fs.writeFileSync(path.join(project, "logs", "old.ansi"), "old");
            fs.mkdirSync(path.join(project, "node_modules"));
            fs.writeFileSync(
                path.join(project, "node_modules", "large"),
                "ignored"
            );

            fs.writeFileSync(
                path.join(linked, "package.json"),
                JSON.stringify({ name: "linked", scripts: { compile: "true" } })
            );
            fs.writeFileSync(path.join(linked, ".gitignore"), "node_modules\n");
            fs.writeFileSync(
                path.join(linked, "index.js"),
                "module.exports = 2;\n"
            );
            const runner = path.join(
                linked,
                "scripts",
                "e2e-parallel",
                "distributed"
            );
            fs.mkdirSync(runner, { recursive: true });
            fs.writeFileSync(
                path.join(runner, "worker.js"),
                "module.exports = {};\n"
            );

            const manifest = await buildRuntimeBundle(project, transfer);
            expect(manifest.version).to.equal(3);
            expect(manifest.rootProjectPath).to.equal("project");
            expect(manifest.runnerEntry).to.equal(
                "linked/scripts/e2e-parallel/distributed/worker.js"
            );
            expect(
                manifest.repositories.map(
                    (entry: { path: string }) => entry.path
                )
            ).to.deep.equal(["linked", "project"]);
            expect(manifest.fileCount).to.be.lessThan(10);
            expect(
                manifest.repositories.find(
                    (entry: { name: string }) => entry.name === "project"
                ).hasYarnLock
            ).to.equal(true);

            await extractRuntimeBundle(
                transfer,
                extracted,
                manifest,
                {
                    maxCompressedBytes: 1024 * 1024,
                    maxExpandedBytes: 1024 * 1024
                },
                manifest.files
            );
            expect(
                fs.readFileSync(
                    path.join(extracted, "linked", "index.js"),
                    "utf8"
                )
            ).to.include("2");
            expect(
                fs.existsSync(path.join(extracted, "project", ".env"))
            ).to.equal(false);
            expect(
                fs.existsSync(path.join(extracted, "project", "logs"))
            ).to.equal(false);
            expect(
                fs.existsSync(path.join(extracted, "project", "node_modules"))
            ).to.equal(false);

            const delta = path.join(root, "transfer", "delta.tgz");
            const deltaManifest = await buildDeltaBundle(
                manifest,
                ["project/index.js"],
                delta
            );
            expect(deltaManifest.fileCount).to.equal(1);
            const emptyManifest = await buildDeltaBundle(manifest, [], delta);
            expect(emptyManifest.fileCount).to.equal(0);
            await extractRuntimeBundle(
                delta,
                extracted,
                { ...manifest, ...emptyManifest },
                {
                    maxCompressedBytes: 1024 * 1024,
                    maxExpandedBytes: 1024 * 1024
                }
            );
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("rejects unsupported manifests and archive checksum changes", async function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "source-workspace-")
        );
        const project = path.join(root, "project");
        const archive = path.join(root, "transfer", "source.tgz");
        try {
            initializeRepository(project);
            fs.writeFileSync(
                path.join(project, "package.json"),
                JSON.stringify({
                    name: "project",
                    scripts: { compile: "true" }
                })
            );
            const runner = path.join(
                project,
                "scripts",
                "e2e-parallel",
                "distributed"
            );
            fs.mkdirSync(runner, { recursive: true });
            fs.writeFileSync(
                path.join(runner, "worker.js"),
                "module.exports = {};\n"
            );
            const manifest = await buildRuntimeBundle(project, archive);
            expect(() =>
                assertCompatible({ ...manifest, version: 2 })
            ).to.throw(/Unsupported/);
            fs.appendFileSync(archive, "corrupt");
            let error: Error | undefined;
            try {
                await extractRuntimeBundle(
                    archive,
                    path.join(root, "out"),
                    manifest,
                    {
                        maxCompressedBytes: 1024 * 1024,
                        maxExpandedBytes: 1024 * 1024
                    }
                );
            } catch (caught) {
                error = caught as Error;
            }
            expect(error?.message).to.include("checksum");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
