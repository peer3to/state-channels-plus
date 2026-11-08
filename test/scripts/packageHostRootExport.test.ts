import { loadedModules } from "@test/utils/loadedModules";
import { repoRoot as findRepoRoot } from "@test/utils/repoRoot";
import { expect } from "chai";
import fs from "fs";
import path from "path";

// The package root, also when this suite runs compiled under dist/.
const repoRoot = findRepoRoot();

/** The EVM package and the factory that creates the EVM from it. */
function evmModules(modules: string[]): string[] {
    return modules.filter(
        (file) =>
            /\/node_modules\/@ethereumjs\/evm\//.test(file) ||
            file.endsWith("/dist/src/evm/EvmFactory.js")
    );
}

describe("package host-root export", function () {
    it("resolves the host-root subpath to the built entry", function () {
        expect(
            require.resolve("@peer3/state-channels-plus/host-root")
        ).to.equal(path.join(repoRoot, "dist", "src", "hostRoot.js"));
    });

    it("exports exactly the host root, as the same value as the package index", function () {
        const entry = require("@peer3/state-channels-plus/host-root");
        const index = require("@peer3/state-channels-plus");
        expect(Object.keys(entry)).to.deep.equal(["P2pRuntimeHostRoot"]);
        expect(entry.P2pRuntimeHostRoot).to.equal(index.P2pRuntimeHostRoot);
    });

    it("mirrors the package index's export targets for every condition", function () {
        const { exports } = JSON.parse(
            fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")
        );
        const index: Record<string, string> = exports["."];
        const expected = Object.fromEntries(
            Object.entries(index).map(([condition, target]) => [
                condition,
                target.replace(/\/index\.(js|d\.ts)$/, "/hostRoot.$1")
            ])
        );
        expect(exports["./host-root"]).to.deep.equal(expected);
    });

    it("loads no EVM", function () {
        expect(
            evmModules(loadedModules("@peer3/state-channels-plus/host-root"))
        ).to.deep.equal([]);
    });

    it("loads the EVM factory through the package index", function () {
        expect(
            evmModules(loadedModules("@peer3/state-channels-plus"))
        ).to.deep.equal(
            ["/dist/src/evm/EvmFactory.js"].map((file) =>
                path.join(repoRoot, file).split(path.sep).join("/")
            )
        );
    });
});
