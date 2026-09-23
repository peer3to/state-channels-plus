import { resolveRuntimeModulePath } from "@/utils/moduleLoader/node/resolveRuntimeModulePath";
import { expect } from "chai";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("Unit: resolveRuntimeModulePath", () => {
    it("returns the named file when it exists, the twin when only the twin exists, and the input otherwise", () => {
        const dir = mkdtempSync(path.join(tmpdir(), "runtime-module-"));
        try {
            const both = path.join(dir, "both.ts");
            writeFileSync(both, "");
            writeFileSync(path.join(dir, "both.js"), "");
            writeFileSync(path.join(dir, "compiledOnly.js"), "");
            writeFileSync(path.join(dir, "sourceOnly.ts"), "");

            expect(resolveRuntimeModulePath(both)).to.equal(both);
            expect(
                resolveRuntimeModulePath(path.join(dir, "compiledOnly.ts"))
            ).to.equal(path.join(dir, "compiledOnly.js"));
            expect(
                resolveRuntimeModulePath(path.join(dir, "sourceOnly.js"))
            ).to.equal(path.join(dir, "sourceOnly.ts"));
            expect(
                resolveRuntimeModulePath(path.join(dir, "missing.ts"))
            ).to.equal(path.join(dir, "missing.ts"));
            expect(resolveRuntimeModulePath("some-package")).to.equal(
                "some-package"
            );
            expect(
                resolveRuntimeModulePath(path.join(dir, "data.json"))
            ).to.equal(path.join(dir, "data.json"));
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
