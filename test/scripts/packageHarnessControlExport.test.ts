// @spec-test-coverage-ignore: test-harness package entry check; the entry is test support outside src/ with no specification or implementation IDs
import { loadedModules } from "@test/utils/loadedModules";
import { repoRoot as findRepoRoot } from "@test/utils/repoRoot";
import { expect } from "chai";
import path from "path";

// The package root, also when this suite runs compiled under dist/.
const repoRoot = findRepoRoot();

/** The peer harness and the test session modules. */
function peerHarnessModules(modules: string[]): string[] {
    return modules.filter((file) =>
        /\/(PeerTestHarness|TestSession)\.js$/.test(file)
    );
}

describe("package test-harness/control export", function () {
    it("resolves the test-harness/control subpath to the built entry", function () {
        expect(
            require.resolve("@peer3/state-channels-plus/test-harness/control")
        ).to.equal(path.join(repoRoot, "dist", "test-harness-control.js"));
    });

    it("exports the harness controls, as the same values as the test-harness entry", function () {
        const entry = require("@peer3/state-channels-plus/test-harness/control");
        const harness = require("@peer3/state-channels-plus/test-harness");
        expect(Object.keys(entry).sort()).to.deep.equal([
            "HarnessControlRpc",
            "RootCreationControl",
            "RuntimeRpcControl",
            "withHarnessControl"
        ]);
        for (const name of Object.keys(entry))
            expect(entry[name], name).to.equal(harness[name]);
    });

    it("loads neither the peer harness nor a test session", function () {
        expect(
            peerHarnessModules(
                loadedModules("@peer3/state-channels-plus/test-harness/control")
            )
        ).to.deep.equal([]);
    });

    it("loads the peer harness and the test session through the test-harness entry", function () {
        expect(
            peerHarnessModules(
                loadedModules("@peer3/state-channels-plus/test-harness")
            ).sort()
        ).to.deep.equal(
            [
                "dist/test/fixtures/PeerTestHarness.js",
                "dist/test/harness/session/TestSession.js"
            ].map((file) => path.join(repoRoot, file).split(path.sep).join("/"))
        );
    });
});
