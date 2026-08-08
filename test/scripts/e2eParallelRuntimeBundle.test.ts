import { expect } from "chai";
import { execFileSync } from "child_process";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { createSocketPair } from "../fixtures/distributed/testTransport";

const {
    buildRuntimeBundle,
    buildDeltaBundle
} = require("../../scripts/e2e-parallel/distributed/runtimeBundle.js");
const {
    extractRuntimeBundle,
    assertCompatible
} = require("../../scripts/e2e-parallel/distributed/runtimeExtractor.js");
const {
    ProtocolPeer
} = require("../../scripts/e2e-parallel/distributed/protocol.js");
const {
    sendBundle,
    receiveBundle
} = require("../../scripts/e2e-parallel/distributed/artifactTransfer.js");

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

    it("leaves the caller's archive untouched and delivers a valid bundle to each concurrent peer", async function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "send-bundle-"));
        const project = path.join(root, "project");
        const archive = path.join(root, "transfer", "source.tgz");
        const openPairs: Array<{ close: () => Promise<void> }> = [];
        const limits = {
            maxCompressedBytes: 64 * 1024 * 1024,
            maxExpandedBytes: 256 * 1024 * 1024
        };
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
            fs.writeFileSync(path.join(runner, "worker.js"), "// worker\n");
            for (let index = 0; index < 40; index++) {
                fs.writeFileSync(
                    path.join(project, `file-${index}.js`),
                    `module.exports = ${index};\n`.repeat(400)
                );
            }
            const manifest = await buildRuntimeBundle(project, archive);
            const changed = manifest.files.map(
                (entry: { path: string }) => entry.path
            );
            const archiveBefore = crypto
                .createHash("sha256")
                .update(fs.readFileSync(archive))
                .digest("hex");

            // Two peers onboarded at once, both handed the same archive path —
            // exactly how the orchestrator drives sendBundle.
            const transfers = await Promise.all(
                [0, 1].map(async (index) => {
                    const pair = await createSocketPair();
                    openPairs.push(pair);
                    const sender = new ProtocolPeer(pair.client);
                    const receiver = new ProtocolPeer(pair.server);
                    const receivedPath = path.join(
                        root,
                        `received-${index}.tgz`
                    );
                    const delivered = new Promise<Record<string, unknown>>(
                        (resolve, reject) => {
                            receiver.on(
                                "message",
                                (message: {
                                    kind: string;
                                    header: Record<string, unknown>;
                                }) => {
                                    if (message.kind === "WORKSPACE_OFFER") {
                                        receiver
                                            .send(
                                                "WORKSPACE_NEED",
                                                {},
                                                Buffer.from(
                                                    JSON.stringify({
                                                        changed,
                                                        deleted: []
                                                    })
                                                )
                                            )
                                            .catch(reject);
                                    } else if (message.kind === "BUNDLE_META") {
                                        receiveBundle(
                                            receiver,
                                            receivedPath,
                                            limits,
                                            resolve,
                                            message,
                                            reject
                                        );
                                    }
                                }
                            );
                        }
                    );
                    await sendBundle(sender, archive, manifest, 16 * 1024);
                    return { receivedPath, delivered: await delivered };
                })
            );

            // The shared path holds the full bundle the caller built; sendBundle
            // must not write through it.
            const archiveAfter = crypto
                .createHash("sha256")
                .update(fs.readFileSync(archive))
                .digest("hex");
            expect(
                archiveAfter,
                "sendBundle wrote through the caller's archive path"
            ).to.equal(archiveBefore);

            // Each peer's archive must be intact gzip, not merely checksum-consistent.
            for (const [index, transfer] of transfers.entries()) {
                await extractRuntimeBundle(
                    transfer.receivedPath,
                    path.join(root, `extracted-${index}`),
                    { ...manifest, ...transfer.delivered },
                    limits
                );
            }
        } finally {
            for (const pair of openPairs) await pair.close();
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
