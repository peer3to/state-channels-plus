import { expect } from "chai";
import fs from "fs";
import os from "os";
import path from "path";

const {
    diffSourceFiles,
    inspectWorkspace,
    removeDeletedFiles,
    commitSourceManifest,
    markPrepared
} = require("../../scripts/e2e-parallel/distributed/workspaceCache.js");

describe("distributed workspace cache", function () {
    const first = [
        { path: "repo/a.ts", bytes: 1, sha256: "a".repeat(64), mode: 420 },
        { path: "repo/old.ts", bytes: 1, sha256: "b".repeat(64), mode: 420 }
    ];
    const second = [
        { path: "repo/a.ts", bytes: 2, sha256: "c".repeat(64), mode: 420 },
        { path: "repo/new.ts", bytes: 1, sha256: "d".repeat(64), mode: 420 }
    ];

    it("requests only changed files and tracks deletions", function () {
        expect(diffSourceFiles(first, second)).to.deep.equal({
            changed: ["repo/a.ts", "repo/new.ts"],
            deleted: ["repo/old.ts"]
        });
    });

    it("persists source and preparation state outside a lease", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "workspace-cache-"));
        const manifest = {
            workspaceId: "1".repeat(64),
            sourceDigest: "source-one",
            files: first
        };
        try {
            let cache = inspectWorkspace(root, manifest);
            expect(cache.changed).to.deep.equal(["repo/a.ts", "repo/old.ts"]);
            fs.mkdirSync(path.join(cache.workspace, "repo"), {
                recursive: true
            });
            fs.writeFileSync(path.join(cache.workspace, "repo", "a.ts"), "x");
            fs.writeFileSync(path.join(cache.workspace, "repo", "old.ts"), "x");
            commitSourceManifest(cache, manifest);
            markPrepared(cache, manifest);

            cache = inspectWorkspace(root, manifest);
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

    it("requests a cached source file again after its disk contents drift", function () {
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
            const cache = inspectWorkspace(root, manifest);
            fs.mkdirSync(
                path.dirname(path.join(cache.workspace, "repo/a.ts")),
                {
                    recursive: true
                }
            );
            fs.writeFileSync(path.join(cache.workspace, "repo/a.ts"), contents);
            commitSourceManifest(cache, manifest);
            fs.writeFileSync(path.join(cache.workspace, "repo/a.ts"), "poison");

            expect(inspectWorkspace(root, manifest).changed).to.deep.equal([
                "repo/a.ts"
            ]);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("invalidates dependency preparation from an older worker policy", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "workspace-cache-"));
        try {
            const manifest = {
                workspaceId: "3".repeat(64),
                sourceDigest: "source-three",
                files: []
            };
            const cache = inspectWorkspace(root, manifest);
            fs.mkdirSync(cache.root, { recursive: true });
            fs.writeFileSync(
                cache.preparedState,
                JSON.stringify({ sourceDigest: manifest.sourceDigest })
            );

            const stale = inspectWorkspace(root, manifest);
            expect(stale.prepared).to.equal(false);
            expect(stale.preparationChanged).to.equal(true);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("normalizes a relative worker root before building cached paths", function () {
        const relativeRoot = path.relative(
            process.cwd(),
            path.join(os.tmpdir(), "relative-workspace-cache")
        );
        const cache = inspectWorkspace(relativeRoot, {
            workspaceId: "2".repeat(64),
            sourceDigest: "source-two",
            files: []
        });

        expect(path.isAbsolute(cache.workspace)).to.equal(true);
        expect(cache.workspace).to.equal(
            path.join(
                path.resolve(relativeRoot),
                "workspaces",
                "2".repeat(64),
                "workspace"
            )
        );
    });
});
