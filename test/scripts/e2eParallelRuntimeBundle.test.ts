// @spec-test-coverage-ignore: developer test-orchestration tooling; not protocol behavior, no specification or implementation IDs apply
import { createSocketPair } from "../fixtures/distributed/testTransport";
import { expect } from "chai";
import { execFileSync } from "child_process";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

const {
    sendBundle,
    receiveBundle
} = require("../../scripts/e2e-parallel/distributed/artifactTransfer.js");
const {
    ProtocolPeer
} = require("../../scripts/e2e-parallel/distributed/protocol.js");
const {
    buildRuntimeManifest,
    buildRuntimeBundle,
    buildDeltaBundle,
    manifestForDistributedProtocol
} = require("../../scripts/e2e-parallel/distributed/runtimeBundle.js");
const {
    extractRuntimeBundle,
    assertCompatible
} = require("../../scripts/e2e-parallel/distributed/runtimeExtractor.js");
const {
    diffSourceFiles
} = require("../../scripts/e2e-parallel/distributed/workspaceCache.js");

function initializeRepository(root: string): void {
    fs.mkdirSync(root, { recursive: true });
    execFileSync("git", ["init", "--quiet"], { cwd: root });
}

describe("distributed source workspace", function () {
    it("preserves linked repository layout and excludes non-runtime files", async function () {
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
            const excludedSourceRoots = [
                ".github",
                ".husky",
                "artifacts",
                "diagrams",
                "docs",
                "internal_docs"
            ];
            for (const repository of [project, linked]) {
                for (const directory of excludedSourceRoots) {
                    const excluded = path.join(repository, directory);
                    fs.mkdirSync(excluded, { recursive: true });
                    fs.writeFileSync(
                        path.join(excluded, "not-runtime.txt"),
                        "not uploaded"
                    );
                }
            }
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

            fs.writeFileSync(
                path.join(project, "test-costs.json"),
                '{"version":1,"tasks":{}}'
            );
            fs.writeFileSync(
                path.join(project, "test-costs.overrides.json"),
                "{}"
            );
            const manifest = await buildRuntimeBundle(project, transfer);
            expect(
                manifest.files.some((entry: { path: string }) =>
                    /test-costs(?:\.overrides)?\.json$/.test(entry.path)
                )
            ).to.equal(false);
            fs.writeFileSync(
                path.join(project, "test-costs.json"),
                '{"version":1,"tasks":{"measured":{}}}'
            );
            fs.writeFileSync(
                path.join(project, "test-costs.overrides.json"),
                '{"adjusted":{}}'
            );
            const costsOnly = await buildRuntimeManifest(project);
            expect(costsOnly.sourceDigest).to.equal(manifest.sourceDigest);

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
            // Without declared build outputs the workers still build it.
            expect(
                manifest.repositories.find(
                    (entry: { name: string }) => entry.name === "project"
                ).prepareScript
            ).to.equal("compile");
            for (const directory of excludedSourceRoots) {
                expect(
                    manifest.files.some((entry: { path: string }) =>
                        entry.path.includes(`/${directory}/`)
                    )
                ).to.equal(false);
            }

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
            for (const repository of ["project", "linked"]) {
                for (const directory of excludedSourceRoots) {
                    expect(
                        fs.existsSync(
                            path.join(extracted, repository, directory)
                        )
                    ).to.equal(false);
                }
            }

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

    it("ships the root's declared build outputs and drops its worker prepare", async function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "build-outputs-"));
        const project = path.join(root, "project");
        const linked = path.join(root, "linked");
        try {
            initializeRepository(project);
            initializeRepository(linked);
            fs.writeFileSync(
                path.join(project, "package.json"),
                JSON.stringify({
                    name: "project",
                    dependencies: { linked: "link:../linked" },
                    scripts: { compile: "true" },
                    peer3TestDistribution: {
                        prepareScript: "compile",
                        cachedPrepareScript: "compile",
                        buildOutputs: [
                            "dist",
                            "artifacts",
                            "generated.ts",
                            "missing"
                        ]
                    }
                })
            );
            fs.writeFileSync(
                path.join(project, ".gitignore"),
                "dist\nartifacts\ngenerated.ts\n"
            );
            fs.mkdirSync(path.join(project, "dist", "nested"), {
                recursive: true
            });
            fs.writeFileSync(path.join(project, "dist", "a.js"), "a");
            fs.writeFileSync(path.join(project, "dist", "nested", "b.js"), "b");
            fs.mkdirSync(path.join(project, "artifacts"));
            fs.writeFileSync(path.join(project, "artifacts", "C.json"), "{}");
            fs.writeFileSync(path.join(project, "generated.ts"), "export {};");
            fs.writeFileSync(
                path.join(linked, "package.json"),
                JSON.stringify({
                    name: "linked",
                    scripts: { compile: "true" },
                    peer3TestDistribution: { buildOutputs: ["dist"] }
                })
            );
            fs.writeFileSync(path.join(linked, ".gitignore"), "dist\n");
            fs.mkdirSync(path.join(linked, "dist"));
            fs.writeFileSync(path.join(linked, "dist", "l.js"), "l");
            const runner = path.join(
                linked,
                "scripts",
                "e2e-parallel",
                "distributed"
            );
            fs.mkdirSync(runner, { recursive: true });
            fs.writeFileSync(path.join(runner, "worker.js"), "");

            const manifest = await buildRuntimeManifest(project);
            const byPath = new Map(
                manifest.files.map(
                    (entry: { path: string; sha256: string }) => [
                        entry.path,
                        entry
                    ]
                )
            );
            for (const output of [
                "project/dist/a.js",
                "project/dist/nested/b.js",
                "project/artifacts/C.json",
                "project/generated.ts"
            ]) {
                expect(byPath.has(output), output).to.equal(true);
            }
            expect(
                (byPath.get("project/dist/a.js") as { sha256: string }).sha256
            ).to.equal(crypto.createHash("sha256").update("a").digest("hex"));
            expect(
                manifest.files.some((entry: { path: string }) =>
                    entry.path.includes("missing")
                )
            ).to.equal(false);
            // Linked repositories are not built by the orchestrator.
            expect(byPath.has("linked/dist/l.js")).to.equal(false);
            const repositories = Object.fromEntries(
                manifest.repositories.map(
                    (entry: {
                        name: string;
                        prepareScript: string | null;
                        cachedPrepareScript: string | null;
                    }) => [entry.name, entry]
                )
            );
            expect(repositories.project.prepareScript).to.equal(null);
            expect(repositories.project.cachedPrepareScript).to.equal(null);
            expect(repositories.linked.prepareScript).to.equal("compile");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("sends only the build outputs whose content changed", async function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "build-outputs-"));
        const project = path.join(root, "project");
        try {
            initializeRepository(project);
            fs.writeFileSync(
                path.join(project, "package.json"),
                JSON.stringify({
                    name: "project",
                    peer3TestDistribution: { buildOutputs: ["dist"] }
                })
            );
            fs.writeFileSync(path.join(project, ".gitignore"), "dist\n");
            fs.mkdirSync(path.join(project, "dist"));
            fs.writeFileSync(path.join(project, "dist", "a.js"), "a");
            fs.writeFileSync(path.join(project, "dist", "b.js"), "b");
            fs.writeFileSync(path.join(project, "dist", "gone.js"), "gone");
            // build tools can leave group/other-writable outputs
            fs.chmodSync(path.join(project, "dist", "a.js"), 0o666);
            const runner = path.join(
                project,
                "scripts",
                "e2e-parallel",
                "distributed"
            );
            fs.mkdirSync(runner, { recursive: true });
            fs.writeFileSync(path.join(runner, "worker.js"), "");

            const before = await buildRuntimeManifest(project);
            // a rebuild rewrites b.js with the same bytes and changes a.js
            fs.writeFileSync(path.join(project, "dist", "a.js"), "a2");
            expect(
                before.files.find(
                    (entry: { path: string }) =>
                        entry.path === "project/dist/a.js"
                ).mode
            ).to.equal(0o644);
            fs.writeFileSync(path.join(project, "dist", "b.js"), "b");
            fs.rmSync(path.join(project, "dist", "gone.js"));
            const after = await buildRuntimeManifest(project);

            expect(diffSourceFiles(before.files, after.files)).to.deep.equal({
                changed: ["project/dist/a.js"],
                deleted: ["project/dist/gone.js"]
            });
            const delta = path.join(root, "delta.tgz");
            const deltaManifest = await buildDeltaBundle(
                after,
                ["project/dist/a.js"],
                delta
            );
            // the delta archive is checked against the manifest entry
            expect(deltaManifest.fileCount).to.equal(1);
            expect(deltaManifest.expandedBytes).to.equal(2);
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

    it("creates only requested deltas and delivers a valid bundle to concurrent peers", async function () {
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
            const manifest = await buildRuntimeManifest(project);
            expect(fs.existsSync(archive)).to.equal(false);
            const changed = manifest.files.map(
                (entry: { path: string }) => entry.path
            );
            // Two peers onboarded at once use the same path only as a stem for
            // isolated, on-demand delta archives.
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

            expect(fs.existsSync(archive)).to.equal(false);

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

    it("a manifest derived for an older worker protocol still builds a delta and keeps the local root off the wire", async function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "source-derived-"));
        const project = path.join(root, "project");
        const delta = path.join(root, "transfer", "delta.tgz");
        try {
            initializeRepository(project);
            fs.writeFileSync(
                path.join(project, "package.json"),
                JSON.stringify({ name: "project" })
            );
            const runner = path.join(
                project,
                "scripts",
                "e2e-parallel",
                "distributed"
            );
            fs.mkdirSync(runner, { recursive: true });
            fs.writeFileSync(path.join(runner, "worker.js"), "// worker\n");
            const manifest = await buildRuntimeManifest(project);
            const derived = manifestForDistributedProtocol(
                manifest,
                manifest.distributedProtocol - 1
            );
            const relative = derived.files.find((entry: { path: string }) =>
                entry.path.endsWith("worker.js")
            ).path;

            const built = await buildDeltaBundle(derived, [relative], delta);

            expect({
                protocol: derived.distributedProtocol,
                workspaceChanged: derived.workspaceId !== manifest.workspaceId,
                fileCount: built.fileCount,
                rootOnTheWire: JSON.stringify(derived).includes(root)
            }).to.deep.equal({
                protocol: manifest.distributedProtocol - 1,
                workspaceChanged: true,
                fileCount: 1,
                rootOnTheWire: false
            });
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("rejects source changes after manifest creation", async function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "source-change-"));
        const project = path.join(root, "project");
        const delta = path.join(root, "transfer", "delta.tgz");
        try {
            initializeRepository(project);
            fs.writeFileSync(
                path.join(project, "package.json"),
                JSON.stringify({ name: "project" })
            );
            const runner = path.join(
                project,
                "scripts",
                "e2e-parallel",
                "distributed"
            );
            fs.mkdirSync(runner, { recursive: true });
            fs.writeFileSync(path.join(runner, "worker.js"), "// original\n");
            const manifest = await buildRuntimeManifest(project);
            const relative = manifest.files.find((entry: { path: string }) =>
                entry.path.endsWith("worker.js")
            ).path;
            fs.writeFileSync(path.join(root, relative), "// changed\n");

            let error: Error | undefined;
            try {
                await buildDeltaBundle(manifest, [relative], delta);
            } catch (caught) {
                error = caught as Error;
            }
            expect(error?.message).to.equal(
                `Source changed after manifest creation: ${relative}`
            );
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
