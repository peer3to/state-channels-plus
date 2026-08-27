// @spec-test-coverage-ignore: developer test-orchestration tooling; not protocol behavior, no specification or implementation IDs apply
import { expect } from "chai";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

const {
    EnvironmentCache,
    deriveEnvironmentKey,
    directoryBytes,
    diffSourceFiles,
    inspectWorkspace,
    removeDeletedFiles,
    commitSourceManifest,
    markPrepared,
    resolveRunnerRepositoryRoot,
    validateWorkspaceManifestPaths
} = require("../../scripts/e2e-parallel/distributed/workspaceCache.js");

describe("distributed workspace cache", function () {
    const orchestratorPublicKey = "e".repeat(64);
    const first = [
        { path: "repo/a.ts", bytes: 1, sha256: "a".repeat(64), mode: 420 },
        { path: "repo/old.ts", bytes: 1, sha256: "b".repeat(64), mode: 420 }
    ];
    const second = [
        { path: "repo/a.ts", bytes: 2, sha256: "c".repeat(64), mode: 420 },
        { path: "repo/new.ts", bytes: 1, sha256: "d".repeat(64), mode: 420 }
    ];

    it("rejects project, repository, and source paths outside the identity workspace", function () {
        const manifest = {
            fileCount: 1,
            files: [{ path: "repo/a.ts" }],
            repositories: [{ path: "repo" }],
            rootProjectPath: "repo"
        };
        expect(() =>
            validateWorkspaceManifestPaths("/environment", manifest)
        ).not.to.throw();
        expect(() =>
            validateWorkspaceManifestPaths("/environment", {
                ...manifest,
                rootProjectPath: "../../tmp"
            })
        ).to.throw("escapes root");
        expect(() =>
            validateWorkspaceManifestPaths("/environment", {
                ...manifest,
                repositories: [{ path: "../other" }]
            })
        ).to.throw("escapes root");
        expect(() =>
            validateWorkspaceManifestPaths("/environment", {
                ...manifest,
                files: [{ path: "/host/sentinel" }]
            })
        ).to.throw("escapes root");
    });

    it("requests only changed files and tracks deletions", function () {
        expect(diffSourceFiles(first, second)).to.deep.equal({
            changed: ["repo/a.ts", "repo/new.ts"],
            deleted: ["repo/old.ts"]
        });
    });

    it("resolves linked runner dependencies separately from the consumer project", function () {
        const workspace = path.join(os.tmpdir(), "distributed-workspace");
        const manifest = {
            rootProjectPath: "poker-contracts",
            runnerEntry:
                "state-channels-plus/scripts/e2e-parallel/distributed/worker.js",
            repositories: [
                { path: "state-channels-plus" },
                { path: "poker-contracts" }
            ]
        };

        expect(resolveRunnerRepositoryRoot(workspace, manifest)).to.equal(
            path.join(workspace, "state-channels-plus")
        );
    });

    it("derives different environment keys for identical source from two orchestrators", function () {
        const workspaceId = "1".repeat(64);
        expect(deriveEnvironmentKey("a".repeat(64), workspaceId)).not.to.equal(
            deriveEnvironmentKey("b".repeat(64), workspaceId)
        );
        expect(deriveEnvironmentKey("a".repeat(64), workspaceId)).to.equal(
            deriveEnvironmentKey("a".repeat(64), workspaceId)
        );
    });

    it("evicts the least recently used idle environment before exceeding the count budget", async function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "environment-cache-")
        );
        try {
            const environments = path.join(root, "environments");
            const oldest = path.join(environments, "1".repeat(64));
            const newest = path.join(environments, "2".repeat(64));
            fs.mkdirSync(oldest, { recursive: true });
            fs.mkdirSync(newest, { recursive: true });
            fs.utimesSync(oldest, new Date(1), new Date(1));
            fs.utimesSync(newest, new Date(2), new Date(2));
            const cache = new EnvironmentCache(root, {
                maxCachedEnvironments: 2,
                maxCacheDiskBytes: 1000,
                maxEnvironmentDiskBytes: 500
            });
            await cache.reserve("3".repeat(64), 1);
            expect(fs.existsSync(oldest)).to.equal(false);
            expect(fs.existsSync(newest)).to.equal(true);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("never evicts active environments and rejects an impossible disk allocation", async function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "environment-cache-")
        );
        try {
            const first = "1".repeat(64);
            const second = "2".repeat(64);
            fs.mkdirSync(path.join(root, "environments", first), {
                recursive: true
            });
            const cache = new EnvironmentCache(root, {
                maxCachedEnvironments: 1,
                maxCacheDiskBytes: 100,
                maxEnvironmentDiskBytes: 50
            });
            cache.active.add(first);
            let activeFailure: Error | undefined;
            try {
                await cache.reserve(second, 1);
            } catch (error) {
                activeFailure = error as Error;
            }
            expect(activeFailure?.message).to.include("No idle environment");
            let diskFailure: Error | undefined;
            try {
                await cache.reserve(second, 51);
            } catch (error) {
                diskFailure = error as Error;
            }
            expect(diskFailure?.message).to.include("exceeds its cache share");
            expect(
                fs.existsSync(path.join(root, "environments", first))
            ).to.equal(true);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("retains the ten most recently used idle environments by default", async function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "environment-cache-")
        );
        try {
            const cache = new EnvironmentCache(root, {
                maxCacheDiskBytes: 1000,
                maxEnvironmentDiskBytes: 100
            });
            for (let index = 0; index < 10; index++) {
                const key = index.toString(16).padStart(64, "0");
                await cache.reserve(key, 1);
                cache.beginStop(key);
                cache.release(key);
            }
            await cache.reserve("f".repeat(64), 1);
            const keys = cache
                .entries()
                .map(
                    (entry: { environmentKey: string }) => entry.environmentKey
                );
            expect(keys).to.have.length(10);
            expect(keys).not.to.include("0".repeat(64));
            expect(keys).to.include("f".repeat(64));
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("uses release-time cache measurements without walking retained workspaces during reservation", async function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "environment-cache-measurement-")
        );
        const first = "1".repeat(64);
        const second = "2".repeat(64);
        let measurements = 0;
        try {
            const retainedRoot = path.join(root, "environments", first);
            fs.mkdirSync(path.join(retainedRoot, "workspace", "nested"), {
                recursive: true
            });
            fs.writeFileSync(
                path.join(retainedRoot, "workspace", "nested", "large.bin"),
                Buffer.alloc(32)
            );
            fs.writeFileSync(
                path.join(retainedRoot, "cache-allocation.json"),
                JSON.stringify({
                    version: 1,
                    reservedDiskBytes: 10,
                    measuredBytes: 40,
                    lastUsedAt: 1
                })
            );
            const cache = new EnvironmentCache(root, {
                maxCachedEnvironments: 2,
                maxCacheDiskBytes: 100,
                maxEnvironmentDiskBytes: 50,
                measureDirectoryBytes(target: string) {
                    measurements += 1;
                    return directoryBytes(target);
                }
            });
            await cache.reserve(second, 10);
            expect(measurements).to.equal(0);
            cache.beginStop(second);
            cache.release(second);
            expect(measurements).to.equal(1);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("persists source and preparation state outside a lease", async function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "workspace-cache-"));
        const contents = "x";
        const sha256 = crypto
            .createHash("sha256")
            .update(contents)
            .digest("hex");
        const files = first.map((entry) => ({ ...entry, sha256 }));
        const manifest = {
            workspaceId: "1".repeat(64),
            sourceDigest: "source-one",
            files
        };
        try {
            let cache = await inspectWorkspace(
                root,
                manifest,
                orchestratorPublicKey
            );
            expect(cache.changed).to.deep.equal(["repo/a.ts", "repo/old.ts"]);
            fs.mkdirSync(path.join(cache.workspace, "repo"), {
                recursive: true
            });
            fs.writeFileSync(
                path.join(cache.workspace, "repo", "a.ts"),
                contents
            );
            fs.writeFileSync(
                path.join(cache.workspace, "repo", "old.ts"),
                contents
            );
            commitSourceManifest(cache, manifest);
            markPrepared(cache, manifest);

            cache = await inspectWorkspace(
                root,
                manifest,
                orchestratorPublicKey
            );
            expect(cache.changed).to.deep.equal([]);
            expect(cache.deleted).to.deep.equal([]);
            expect(cache.prepared).to.equal(true);
            expect(cache.preparationChanged).to.equal(false);

            removeDeletedFiles(cache.workspace, ["repo/old.ts"]);
            expect(
                fs.existsSync(path.join(cache.workspace, "repo", "old.ts"))
            ).to.equal(false);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("requests a cached source file again after its disk contents drift", async function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "workspace-cache-"));
        const contents = "source";
        const manifest = {
            workspaceId: "4".repeat(64),
            sourceDigest: "source-four",
            files: [
                {
                    path: "repo/a.ts",
                    bytes: contents.length,
                    sha256: require("crypto")
                        .createHash("sha256")
                        .update(contents)
                        .digest("hex"),
                    mode: 420
                }
            ]
        };
        try {
            const cache = await inspectWorkspace(
                root,
                manifest,
                orchestratorPublicKey
            );
            fs.mkdirSync(
                path.dirname(path.join(cache.workspace, "repo/a.ts")),
                {
                    recursive: true
                }
            );
            fs.writeFileSync(path.join(cache.workspace, "repo/a.ts"), contents);
            commitSourceManifest(cache, manifest);
            fs.writeFileSync(path.join(cache.workspace, "repo/a.ts"), "poison");

            expect(
                (await inspectWorkspace(root, manifest, orchestratorPublicKey))
                    .changed
            ).to.deep.equal(["repo/a.ts"]);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("invalidates dependency preparation from an older worker policy", async function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "workspace-cache-"));
        try {
            const manifest = {
                workspaceId: "3".repeat(64),
                sourceDigest: "source-three",
                files: []
            };
            const cache = await inspectWorkspace(
                root,
                manifest,
                orchestratorPublicKey
            );
            fs.mkdirSync(cache.root, { recursive: true });
            fs.writeFileSync(
                cache.preparedState,
                JSON.stringify({ sourceDigest: manifest.sourceDigest })
            );

            const stale = await inspectWorkspace(
                root,
                manifest,
                orchestratorPublicKey
            );
            expect(stale.prepared).to.equal(false);
            expect(stale.preparationChanged).to.equal(true);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("tracks contract preparation independently from source-only changes", async function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "workspace-cache-"));
        const file = (filePath: string, contents: string) => ({
            path: filePath,
            bytes: contents.length,
            sha256: crypto.createHash("sha256").update(contents).digest("hex"),
            mode: 420
        });
        const contract = file("repo/contracts/Channel.sol", "contract A {}");
        const source = file("repo/src/index.ts", "export const value = 1;");
        const manifest = {
            workspaceId: "5".repeat(64),
            sourceDigest: "source-five",
            repositories: [
                {
                    path: "repo",
                    contractCompileInputs: ["contracts/"]
                }
            ],
            files: [contract, source]
        };
        try {
            const cache = await inspectWorkspace(
                root,
                manifest,
                orchestratorPublicKey
            );
            fs.mkdirSync(path.join(cache.workspace, "repo/contracts"), {
                recursive: true
            });
            fs.mkdirSync(path.join(cache.workspace, "repo/src"), {
                recursive: true
            });
            fs.writeFileSync(
                path.join(cache.workspace, contract.path),
                "contract A {}"
            );
            fs.writeFileSync(
                path.join(cache.workspace, source.path),
                "export const value = 1;"
            );
            commitSourceManifest(cache, manifest);
            markPrepared(cache, manifest);

            const changedSource = file(
                "repo/src/index.ts",
                "export const value = 2;"
            );
            const sourceOnlyManifest = {
                ...manifest,
                sourceDigest: "source-six",
                files: [contract, changedSource]
            };
            fs.writeFileSync(
                path.join(cache.workspace, changedSource.path),
                "export const value = 2;"
            );
            commitSourceManifest(cache, sourceOnlyManifest);
            const sourceOnly = await inspectWorkspace(
                root,
                sourceOnlyManifest,
                orchestratorPublicKey
            );
            expect(sourceOnly.changed).to.deep.equal([]);
            expect(sourceOnly.prepared).to.equal(false);
            expect(sourceOnly.contractPreparationChanged).to.equal(false);

            const changedContract = file(
                "repo/contracts/Channel.sol",
                "contract B {}"
            );
            const changedManifest = {
                ...manifest,
                sourceDigest: "source-seven",
                files: [changedContract, changedSource]
            };
            fs.writeFileSync(
                path.join(cache.workspace, changedContract.path),
                "contract B {}"
            );
            commitSourceManifest(cache, changedManifest);
            const contractChanged = await inspectWorkspace(
                root,
                changedManifest,
                orchestratorPublicKey
            );
            expect(contractChanged.changed).to.deep.equal([]);
            expect(contractChanged.contractPreparationChanged).to.equal(true);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("normalizes a relative worker root before building cached paths", async function () {
        const relativeRoot = path.relative(
            process.cwd(),
            path.join(os.tmpdir(), "relative-workspace-cache")
        );
        const manifest = {
            workspaceId: "2".repeat(64),
            sourceDigest: "source-two",
            files: []
        };
        const cache = await inspectWorkspace(
            relativeRoot,
            manifest,
            orchestratorPublicKey
        );

        expect(path.isAbsolute(cache.workspace)).to.equal(true);
        expect(cache.workspace).to.equal(
            path.join(
                path.resolve(relativeRoot),
                "environments",
                cache.environmentKey,
                "workspace"
            )
        );
    });
});
