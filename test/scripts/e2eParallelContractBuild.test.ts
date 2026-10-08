// @spec-test-coverage-ignore: developer test-orchestration tooling; not protocol behavior, no specification or implementation IDs apply
import {
    contractProject,
    runContractProject
} from "../fixtures/node/ContractBuildProjectFixture";
import { expect } from "chai";

describe("parallel runner contract build", function () {
    it("distributed CLI compiles missing bindings before the TypeScript build and discovery", function () {
        const project = contractProject();
        try {
            const result = runContractProject(project, [
                "--distributed",
                "--no-forge",
                "--no-browser",
                "--grep",
                "no matching test"
            ]);
            expect(
                result.stdout + result.stderr,
                result.stdout + result.stderr
            ).to.contain("No selected tests matched --grep");
            expect(project.exists("dist/src/index.js")).to.equal(true);
            expect(project.read("generator-runs")).to.equal("11");
        } finally {
            project.dispose();
        }
    });

    it("distributed CLI lets Hardhat skip unchanged contracts on a warm run", function () {
        const project = contractProject();
        try {
            const args = [
                "--distributed",
                "--no-forge",
                "--no-browser",
                "--grep",
                "no matching test"
            ];
            const cold = runContractProject(project, args);
            expect(
                cold.stdout + cold.stderr,
                cold.stdout + cold.stderr
            ).to.contain("No selected tests matched --grep");
            const warm = runContractProject(project, args);
            expect(warm.stdout).to.contain("Nothing to compile");
            expect(warm.stdout).not.to.contain(
                "Building the compiled test tree"
            );
            expect(warm.stdout).not.to.contain(
                "Refreshing the compiled test tree"
            );
            expect(warm.stdout).not.to.contain("hardhat typechain");
            expect(
                warm.stdout + warm.stderr,
                warm.stdout + warm.stderr
            ).to.contain("No selected tests matched --grep");
        } finally {
            project.dispose();
        }
    });

    it("distributed CLI stops before TypeScript compilation when contracts fail", function () {
        const project = contractProject();
        try {
            project.write("contracts/Value.sol", "invalid Solidity");
            const result = runContractProject(project, [
                "--distributed",
                "--no-forge",
                "--no-browser"
            ]);
            expect(result.status).to.equal(1);
            expect(result.stderr).to.contain(
                "Fix contract compilation before building the TypeScript test tree."
            );
            expect(project.exists("dist/src/index.js")).to.equal(false);
        } finally {
            project.dispose();
        }
    });

    it("distributed dry runs do not compile contracts", function () {
        const project = contractProject();
        try {
            const result = runContractProject(project, [
                "--distributed",
                "--dry-run",
                "--source-tests",
                "--no-forge",
                "--no-browser"
            ]);
            expect(
                result.stdout + result.stderr,
                result.stdout + result.stderr
            ).to.contain("Distributed dry run: 1 task(s)");
            expect(project.exists("generator-runs")).to.equal(false);
        } finally {
            project.dispose();
        }
    });

    it("distributed skip-build leaves existing contract outputs alone", function () {
        const project = contractProject();
        try {
            const result = runContractProject(project, [
                "--distributed",
                "--skip-build",
                "--source-tests",
                "--no-forge",
                "--no-browser",
                "--grep",
                "no matching test"
            ]);
            expect(
                result.stdout + result.stderr,
                result.stdout + result.stderr
            ).to.contain("No selected tests matched --grep");
            expect(project.exists("generator-runs")).to.equal(false);
        } finally {
            project.dispose();
        }
    });
});
