import { repoRoot as findRepoRoot } from "@test/utils/repoRoot";
import { expect } from "chai";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

// The package root, also when this suite runs compiled under dist/.
const repoRoot = findRepoRoot();

const INTERNAL_ROOT_RUNTIME_EXPORTS = [
    "AInternalRpcMethods",
    "AInternalRpcRoot",
    "AInternalRpcService",
    "createRoot",
    "startRootWorker"
];

/** The modules a fresh node process holds after requiring `specifier`. */
function loadedModules(specifier: string): string[] {
    const output = execFileSync(
        process.execPath,
        [
            "--eval",
            `require(${JSON.stringify(specifier)}); console.log(JSON.stringify(Object.keys(require.cache)));`
        ],
        { cwd: repoRoot, encoding: "utf8" }
    );
    return (JSON.parse(output.trim().split("\n").pop()!) as string[]).map(
        (file) => file.split(path.sep).join("/")
    );
}

/** The P2P runtime host, its relay, and the packages that create WASM at import. */
function runtimeModules(modules: string[]): string[] {
    return modules.filter(
        (file) =>
            /\/node_modules\/(hyperswarm|@hyperswarm|sodium-[^/]+)\//.test(
                file
            ) ||
            /\/dist\/src\/(HolepunchRelay|Holepunch|P2PManager|rpc\/internal\/roots\/P2pRuntimeHostRoot)\.js$/.test(
                file
            )
    );
}

describe("package internal-root export", function () {
    it("resolves the internal-root subpath to the built entry", function () {
        expect(
            require.resolve("@peer3/state-channels-plus/internal-root")
        ).to.equal(path.join(repoRoot, "dist", "src", "internalRoot.js"));
    });

    it("exports exactly the internal root API, as the same values as the package index", function () {
        const entry = require("@peer3/state-channels-plus/internal-root");
        const index = require("@peer3/state-channels-plus");
        expect(Object.keys(entry).sort()).to.deep.equal(
            INTERNAL_ROOT_RUNTIME_EXPORTS
        );
        for (const name of INTERNAL_ROOT_RUNTIME_EXPORTS) {
            expect(entry[name], name).to.equal(index[name]);
        }
    });

    it("mirrors the package index's export targets for every condition", function () {
        const { exports } = JSON.parse(
            fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")
        );
        const index: Record<string, string> = exports["."];
        const expected = Object.fromEntries(
            Object.entries(index).map(([condition, target]) => [
                condition,
                target.replace(/\/index\.(js|d\.ts)$/, "/internalRoot.$1")
            ])
        );
        expect(exports["./internal-root"]).to.deep.equal(expected);
        expect(Object.keys(expected)).to.have.members([
            "types",
            "browser",
            "node",
            "import",
            "default"
        ]);
    });

    it("loads neither the P2P runtime host nor its relay", function () {
        expect(
            runtimeModules(
                loadedModules("@peer3/state-channels-plus/internal-root")
            )
        ).to.deep.equal([]);
    });

    it("loads the P2P runtime host and its relay through the package index", function () {
        const modules = runtimeModules(
            loadedModules("@peer3/state-channels-plus")
        );
        expect(
            modules.some((file) => file.endsWith("/dist/src/HolepunchRelay.js"))
        ).to.equal(true);
    });
});
