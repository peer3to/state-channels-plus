// @spec-test-coverage-ignore: developer test-orchestration tooling; not protocol behavior, no specification or implementation IDs apply
import {
    CompiledTreeProject,
    FAILING_SCRIPT,
    markerScript,
    tscScript
} from "../fixtures/node/CompiledTreeProjectFixture";
import { expect } from "chai";

type TreeState = "current" | "refresh" | "rebuild";

const { compiledTreeState, refreshCompiledTestTree, writeStamp, STAMP_PATH } =
    require("../../scripts/e2e-parallel/shared/compiledTree.js") as {
        compiledTreeState: (root: string) => TreeState;
        refreshCompiledTestTree: (root: string) => string | undefined;
        writeStamp: (root: string) => void;
        STAMP_PATH: string;
    };

const WASM = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
const WASM_CHANGED = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x02, 0x00, 0x00]);

describe("parallel runner compiled test tree", function () {
    it("reports rebuild when no stamp exists", function () {
        const project = CompiledTreeProject.create({
            files: { "src/index.ts": "export {};" }
        });
        try {
            expect(compiledTreeState(project.root)).to.equal("rebuild");
        } finally {
            project.dispose();
        }
    });

    it("reports current right after the stamp and refresh after a content change", function () {
        const project = CompiledTreeProject.create({
            files: { "src/index.ts": "export {};", "test/a.test.ts": "" }
        });
        try {
            writeStamp(project.root);
            expect(compiledTreeState(project.root)).to.equal("current");
            project.change("src/index.ts", "export const x = 1;");
            expect(compiledTreeState(project.root)).to.equal("refresh");
        } finally {
            project.dispose();
        }
    });

    it("leaves an untouched project current and runs no build script", function () {
        const project = CompiledTreeProject.create({
            scripts: {
                "test:parallel:build": markerScript("ran-build"),
                "test:parallel:refresh": markerScript("ran-refresh")
            },
            files: { "src/index.ts": "export {};" }
        });
        try {
            writeStamp(project.root);
            const stamp = project.read(STAMP_PATH);
            expect(refreshCompiledTestTree(project.root)).to.equal(undefined);
            expect(project.exists("ran-build")).to.equal(false);
            expect(project.exists("ran-refresh")).to.equal(false);
            expect(project.read(STAMP_PATH)).to.equal(stamp);
        } finally {
            project.dispose();
        }
    });

    it("reports rebuild when a source file is added or removed", function () {
        const project = CompiledTreeProject.create({
            files: { "src/index.ts": "export {};", "src/old.ts": "" }
        });
        try {
            writeStamp(project.root);
            project.write("src/new.ts", "");
            expect(compiledTreeState(project.root)).to.equal("rebuild");
            writeStamp(project.root);
            project.remove("src/old.ts");
            expect(compiledTreeState(project.root)).to.equal("rebuild");
        } finally {
            project.dispose();
        }
    });

    it("tracks the files the tsconfig include selects and ignores the others", function () {
        const project = CompiledTreeProject.create({
            tsconfig: {
                compilerOptions: { outDir: "dist" },
                include: ["./sdk/**/*.ts", "./hardhat.config.ts"]
            },
            files: {
                "sdk/prover.ts": "export {};",
                "hardhat.config.ts": "export default {};",
                "src/unlisted.ts": ""
            }
        });
        try {
            writeStamp(project.root);
            project.write("src/other.ts", "");
            project.change("src/unlisted.ts", "export const x = 1;");
            expect(compiledTreeState(project.root)).to.equal("current");
            project.change("hardhat.config.ts", "export default { a: 1 };");
            expect(compiledTreeState(project.root)).to.equal("refresh");
            project.write("sdk/verifier.ts", "");
            expect(compiledTreeState(project.root)).to.equal("rebuild");
        } finally {
            project.dispose();
        }
    });

    it("reports refresh when an imported TypeScript dependency outside the include changes", function () {
        const project = CompiledTreeProject.create({
            tsconfig: {
                compilerOptions: { outDir: "dist" },
                include: ["test/**/*.ts"]
            },
            files: {
                "test/a.test.ts":
                    'import { value } from "../lib/dep";\nexport const seen = value;',
                "lib/dep.ts": "export const value = 1;",
                "lib/unused.ts": "export const unused = 1;"
            }
        });
        try {
            writeStamp(project.root);
            project.change("lib/unused.ts", "export const unused = 2;");
            expect(compiledTreeState(project.root)).to.equal("current");
            project.change("lib/dep.ts", "export const value = 2;");
            expect(compiledTreeState(project.root)).to.equal("refresh");
        } finally {
            project.dispose();
        }
    });

    it("recompiles an imported TypeScript dependency outside the include with the project's tsc build", function () {
        const project = CompiledTreeProject.create({
            scripts: { "test:parallel:build": tscScript() },
            tsconfig: {
                compilerOptions: { outDir: "dist", module: "commonjs" },
                include: ["test/**/*.ts"]
            },
            files: {
                "test/a.test.ts":
                    'import { value } from "../lib/dep";\nexport const seen = value;',
                "lib/dep.ts": "export const value = 1;"
            }
        });
        try {
            expect(refreshCompiledTestTree(project.root)).to.equal(undefined);
            expect(project.read("dist/lib/dep.js")).to.contain("value = 1");
            expect(compiledTreeState(project.root)).to.equal("current");
            project.change("lib/dep.ts", "export const value = 2;");
            expect(refreshCompiledTestTree(project.root)).to.equal(undefined);
            expect(project.read("dist/lib/dep.js")).to.contain("value = 2");
        } finally {
            project.dispose();
        }
    });

    it("tracks every directory a glob-only tsconfig include matches", function () {
        const project = CompiledTreeProject.create({
            tsconfig: {
                compilerOptions: { outDir: "dist" },
                include: ["**/*.ts"]
            },
            files: { "sdk/prover.ts": "export {};", "test/a.test.ts": "" }
        });
        try {
            writeStamp(project.root);
            project.change("sdk/prover.ts", "export const x = 1;");
            expect(compiledTreeState(project.root)).to.equal("refresh");
            writeStamp(project.root);
            project.write("sdk/verifier.ts", "");
            expect(compiledTreeState(project.root)).to.equal("rebuild");
        } finally {
            project.dispose();
        }
    });

    it("reads a JSONC tsconfig with comments and trailing commas", function () {
        const project = CompiledTreeProject.create({
            tsconfig: [
                "{",
                "    // Only the SDK sources are compiled.",
                '    "compilerOptions": { "outDir": "dist", },',
                '    "include": ["sdk/**/*.ts",],',
                "}"
            ].join("\n"),
            files: { "sdk/prover.ts": "export {};", "src/unlisted.ts": "" }
        });
        try {
            writeStamp(project.root);
            expect(compiledTreeState(project.root)).to.equal("current");
            project.change("src/unlisted.ts", "export const x = 1;");
            expect(compiledTreeState(project.root)).to.equal("current");
            project.change("sdk/prover.ts", "export const x = 1;");
            expect(compiledTreeState(project.root)).to.equal("refresh");
            writeStamp(project.root);
            project.write("sdk/verifier.ts", "");
            expect(compiledTreeState(project.root)).to.equal("rebuild");
        } finally {
            project.dispose();
        }
    });

    it("applies the include of an extended tsconfig and tracks the extended file", function () {
        const project = CompiledTreeProject.create({
            tsconfig: { extends: "./configs/base.json" },
            files: {
                "configs/base.json": JSON.stringify({
                    compilerOptions: { outDir: "../dist" },
                    include: ["../sdk/**/*.ts"]
                }),
                "sdk/prover.ts": "export {};",
                "src/unlisted.ts": ""
            }
        });
        try {
            writeStamp(project.root);
            expect(compiledTreeState(project.root)).to.equal("current");
            project.write("src/other.ts", "");
            expect(compiledTreeState(project.root)).to.equal("current");
            project.change(
                "configs/base.json",
                JSON.stringify({
                    compilerOptions: { outDir: "../dist", strict: true },
                    include: ["../sdk/**/*.ts"]
                })
            );
            expect(compiledTreeState(project.root)).to.equal("refresh");
            writeStamp(project.root);
            project.write("sdk/verifier.ts", "");
            expect(compiledTreeState(project.root)).to.equal("rebuild");
        } finally {
            project.dispose();
        }
    });

    it("reports refresh when an included declaration file is deleted", function () {
        const project = CompiledTreeProject.create({
            files: {
                "src/index.ts": "export const seen = GLOBAL_VALUE;",
                "src/types/globals.d.ts": "declare const GLOBAL_VALUE: number;"
            }
        });
        try {
            writeStamp(project.root);
            expect(compiledTreeState(project.root)).to.equal("current");
            project.remove("src/types/globals.d.ts");
            expect(compiledTreeState(project.root)).to.equal("refresh");
            writeStamp(project.root);
            expect(compiledTreeState(project.root)).to.equal("current");
        } finally {
            project.dispose();
        }
    });

    it("reports refresh when an included declaration file is renamed", function () {
        const project = CompiledTreeProject.create({
            files: {
                "src/index.ts": "export const seen = GLOBAL_VALUE;",
                "src/types/globals.d.ts": "declare const GLOBAL_VALUE: number;"
            }
        });
        try {
            writeStamp(project.root);
            project.rename("src/types/globals.d.ts", "src/types/ambient.d.ts");
            expect(compiledTreeState(project.root)).to.equal("refresh");
            writeStamp(project.root);
            expect(compiledTreeState(project.root)).to.equal("current");
        } finally {
            project.dispose();
        }
    });

    it("runs the refresh script, not the build script, when an included declaration file is deleted", function () {
        const project = CompiledTreeProject.create({
            scripts: {
                "test:parallel:build": markerScript("ran-build"),
                "test:parallel:refresh": markerScript("ran-refresh")
            },
            files: {
                "src/index.ts": "export const seen = GLOBAL_VALUE;",
                "src/types/globals.d.ts": "declare const GLOBAL_VALUE: number;"
            }
        });
        try {
            writeStamp(project.root);
            project.remove("src/types/globals.d.ts");
            expect(refreshCompiledTestTree(project.root)).to.equal(undefined);
            expect(project.exists("ran-refresh")).to.equal(true);
            expect(project.exists("ran-build")).to.equal(false);
            expect(compiledTreeState(project.root)).to.equal("current");
        } finally {
            project.dispose();
        }
    });

    it("reports refresh when only a .wasm binary changes content", function () {
        const project = CompiledTreeProject.create({
            files: { "src/index.ts": "", "src/wasm/prover_bg.wasm": WASM }
        });
        try {
            writeStamp(project.root);
            project.change("src/wasm/prover_bg.wasm", WASM_CHANGED);
            expect(compiledTreeState(project.root)).to.equal("refresh");
        } finally {
            project.dispose();
        }
    });

    it("reports rebuild when a .wasm binary is added or deleted", function () {
        const project = CompiledTreeProject.create({
            files: { "src/index.ts": "", "src/wasm/prover_bg.wasm": WASM }
        });
        try {
            writeStamp(project.root);
            project.write("src/wasm/verifier_bg.wasm", WASM);
            expect(compiledTreeState(project.root)).to.equal("rebuild");
            writeStamp(project.root);
            project.remove("src/wasm/prover_bg.wasm");
            expect(compiledTreeState(project.root)).to.equal("rebuild");
        } finally {
            project.dispose();
        }
    });

    it("runs the build script on a content change when the project has no refresh script", function () {
        const project = CompiledTreeProject.create({
            scripts: { "test:parallel:build": markerScript("ran-build") },
            files: { "src/index.ts": "" }
        });
        try {
            writeStamp(project.root);
            const stamp = project.read(STAMP_PATH);
            project.change("src/index.ts", "export {};");
            expect(refreshCompiledTestTree(project.root)).to.equal(undefined);
            expect(project.exists("ran-build")).to.equal(true);
            expect(project.read(STAMP_PATH)).not.to.equal(stamp);
        } finally {
            project.dispose();
        }
    });

    it("runs the refresh script on a content change when the project has one", function () {
        const project = CompiledTreeProject.create({
            scripts: {
                "test:parallel:build": markerScript("ran-build"),
                "test:parallel:refresh": markerScript("ran-refresh")
            },
            files: { "src/index.ts": "" }
        });
        try {
            writeStamp(project.root);
            const stamp = project.read(STAMP_PATH);
            project.change("src/index.ts", "export {};");
            expect(refreshCompiledTestTree(project.root)).to.equal(undefined);
            expect(project.exists("ran-refresh")).to.equal(true);
            expect(project.exists("ran-build")).to.equal(false);
            expect(project.read(STAMP_PATH)).not.to.equal(stamp);
        } finally {
            project.dispose();
        }
    });

    it("runs the build script, not the refresh script, when the file set changed", function () {
        const project = CompiledTreeProject.create({
            scripts: {
                "test:parallel:build": markerScript("ran-build"),
                "test:parallel:refresh": markerScript("ran-refresh")
            },
            files: { "src/index.ts": "" }
        });
        try {
            expect(refreshCompiledTestTree(project.root)).to.equal(undefined);
            expect(project.exists("ran-build")).to.equal(true);
            expect(project.exists("ran-refresh")).to.equal(false);
            expect(project.exists(STAMP_PATH)).to.equal(true);
        } finally {
            project.dispose();
        }
    });

    it("returns the failure and writes no stamp when the build script fails", function () {
        const project = CompiledTreeProject.create({
            scripts: { "test:parallel:build": FAILING_SCRIPT },
            files: { "src/index.ts": "" }
        });
        try {
            expect(refreshCompiledTestTree(project.root)).to.equal(
                "Building the compiled test tree failed (yarn -s test:parallel:build)"
            );
            expect(project.exists(STAMP_PATH)).to.equal(false);
            expect(compiledTreeState(project.root)).to.equal("rebuild");
        } finally {
            project.dispose();
        }
    });

    it("keeps the old stamp when the refresh script fails", function () {
        const project = CompiledTreeProject.create({
            scripts: {
                "test:parallel:build": markerScript("ran-build"),
                "test:parallel:refresh": FAILING_SCRIPT
            },
            files: { "src/index.ts": "" }
        });
        try {
            writeStamp(project.root);
            const stamp = project.read(STAMP_PATH);
            project.change("src/index.ts", "export {};");
            expect(refreshCompiledTestTree(project.root)).to.equal(
                "Building the compiled test tree failed (yarn -s test:parallel:refresh)"
            );
            expect(project.read(STAMP_PATH)).to.equal(stamp);
            expect(compiledTreeState(project.root)).to.equal("refresh");
        } finally {
            project.dispose();
        }
    });
});
