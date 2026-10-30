// @spec-test-coverage-ignore: developer code-generation tooling; no protocol behavior
import { CompiledTreeProject } from "../fixtures/node/CompiledTreeProjectFixture";
import { repoRoot } from "../utils/repoRoot";
import { expect } from "chai";
import fs from "fs";
import path from "path";

const { writeFileIfChanged } = require(
    path.join(repoRoot(), "scripts/write-if-changed.js")
);

describe("generated file writes", function () {
    it("creates missing output and replaces changed output", function () {
        const project = CompiledTreeProject.create({});
        try {
            const file = project.path("generated.ts");
            expect(
                writeFileIfChanged(file, "export const value = 1;")
            ).to.equal(true);
            expect(
                writeFileIfChanged(file, "export const value = 2;")
            ).to.equal(true);
            expect(project.read("generated.ts")).to.equal(
                "export const value = 2;"
            );
        } finally {
            project.dispose();
        }
    });

    it("preserves the modification time of identical generated output", function () {
        const project = CompiledTreeProject.create({
            files: { "generated.ts": "export {};" }
        });
        try {
            const file = project.path("generated.ts");
            const before = fs.statSync(file).mtimeMs;
            expect(writeFileIfChanged(file, "export {};")).to.equal(false);
            expect(fs.statSync(file).mtimeMs).to.equal(before);
        } finally {
            project.dispose();
        }
    });

    it("propagates read failures rather than overwriting an invalid output path", function () {
        const project = CompiledTreeProject.create({});
        try {
            expect(() =>
                writeFileIfChanged(project.root, "export {};")
            ).to.throw();
            expect(fs.statSync(project.root).isDirectory()).to.equal(true);
        } finally {
            project.dispose();
        }
    });
});
