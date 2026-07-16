import { expect } from "chai";
import fs from "fs";
import os from "os";
import path from "path";

const { discoverTasks } =
    require("../../scripts/e2e-parallel/taskDiscovery.js") as {
        discoverTasks: (
            testDir: string,
            grep?: string,
            e2eDir?: string
        ) => {
            files: string[];
            tasks: Array<{
                fullTitle: string;
                isE2E: boolean;
                args: string[];
            }>;
        };
    };

describe("parallel Mocha task discovery", function () {
    it("discovers ordinary and E2E tests and marks only E2E tasks for shared infra", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "mocha-discovery-"));
        const testDir = path.join(root, "test");
        const e2eDir = path.join(testDir, "e2e");
        const unitDir = path.join(testDir, "unit");
        fs.mkdirSync(e2eDir, { recursive: true });
        fs.mkdirSync(unitDir, { recursive: true });
        fs.writeFileSync(
            path.join(e2eDir, "flow.test.ts"),
            'describe("E2E: flow", () => { it("runs", () => {}); });'
        );
        fs.writeFileSync(
            path.join(unitDir, "logic.test.ts"),
            'describe("logic", () => { describe("nested", () => { it("works", () => {}); }); });'
        );

        try {
            const { tasks } = discoverTasks(testDir, undefined, e2eDir);
            expect(tasks.map((task) => task.fullTitle)).to.have.members([
                "E2E: flow runs",
                "logic nested works"
            ]);
            expect(
                tasks.find((task) => task.fullTitle === "E2E: flow runs")?.isE2E
            ).to.equal(true);
            expect(
                tasks.find((task) => task.fullTitle === "logic nested works")
                    ?.isE2E
            ).to.equal(false);
            expect(tasks[0].args).to.include("--grep");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("applies --grep to the full nested Mocha title", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "mocha-grep-"));
        const testDir = path.join(root, "test");
        fs.mkdirSync(testDir, { recursive: true });
        fs.writeFileSync(
            path.join(testDir, "logic.test.ts"),
            'describe("logic", () => { it("first", () => {}); it("second", () => {}); });'
        );

        try {
            const { tasks } = discoverTasks(testDir, "logic second");
            expect(tasks).to.have.lengthOf(1);
            expect(tasks[0].fullTitle).to.equal("logic second");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
