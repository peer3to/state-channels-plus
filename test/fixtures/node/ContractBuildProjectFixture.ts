// @spec-test-coverage-ignore: developer test-orchestration fixture; no protocol behavior
import {
    CompiledTreeProject,
    FAILING_SCRIPT,
    tscScript
} from "./CompiledTreeProjectFixture";
import { repoRoot } from "../../utils/repoRoot";
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

const RUNNER = require.resolve("../../../scripts/test-e2e-parallel.js");

export function contractProject() {
    const project = CompiledTreeProject.create({
        tsconfig: {
            compilerOptions: {
                outDir: "dist",
                target: "ES2020",
                module: "commonjs",
                skipLibCheck: true,
                types: []
            },
            include: ["src", "test", "generated", "typechain-types"]
        },
        files: {
            "hardhat.config.js":
                'require("@typechain/hardhat"); module.exports = { solidity: "0.8.34", typechain: { target: "ethers-v6" } };',
            "contracts/Value.sol":
                "pragma solidity ^0.8.0; contract Value { function value() external pure returns (uint256) { return 1; } }",
            "generate.cjs": `const fs = require('fs');
const { writeFileIfChanged } = require(${JSON.stringify(path.join(repoRoot(), "scripts/write-if-changed.js"))});
const artifact = require('./artifacts/contracts/Value.sol/Value.json');
fs.mkdirSync('generated', { recursive: true });
writeFileIfChanged('generated/value.ts', 'export const abi = ' + JSON.stringify(artifact.abi) + ';');
fs.appendFileSync('generator-runs', '1');`,
            "src/index.ts":
                'export { abi } from "../generated/value"; export type { Value } from "../typechain-types";',
            "test/a.test.ts":
                'export {}; declare function it(name: string, fn: () => void): void; it("compiles", () => {});'
        },
        scripts: {
            // The preflight must use the incremental building blocks, never this clean-build command.
            compile: FAILING_SCRIPT,
            "generate-enums": "node generate.cjs",
            "generate-artifacts": "node generate.cjs",
            "test:parallel:build": tscScript()
        }
    });
    fs.symlinkSync(
        path.join(repoRoot(), "node_modules"),
        project.path("node_modules"),
        "dir"
    );
    return project;
}

export function runContractProject(
    project: CompiledTreeProject,
    args: string[]
) {
    return spawnSync(process.execPath, [RUNNER, ...args], {
        cwd: project.root,
        encoding: "utf8"
    });
}
