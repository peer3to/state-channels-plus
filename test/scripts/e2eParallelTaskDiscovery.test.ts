// @spec-test-coverage-ignore: developer test-orchestration tooling; not protocol behavior, no specification or implementation IDs apply
import { expect } from "chai";
import fs from "fs";
import os from "os";
import path from "path";

const { discoverTasks } =
    require("../../scripts/e2e-parallel/shared/taskDiscovery.js") as {
        discoverTasks: (
            testDir: string,
            grep?: string,
            e2eDir?: string,
            testPattern?: string,
            projectRoot?: string
        ) => {
            files: string[];
            tasks: Array<{
                fullTitle: string;
                identity: string;
                isE2E: boolean;
                args: string[];
            }>;
        };
    };
const {
    toWireTask,
    fromWireTask
} = require("../../scripts/e2e-parallel/distributed/taskWire.js");

const { selectRunnerTests } = require("../../scripts/test-e2e-parallel");

describe("parallel Mocha task discovery", function () {
    it("default selection excludes runner tests but retains harness tests and honors explicit selections", function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "runner-selection-")
        );
        try {
            for (const bucket of ["scripts", "harness", "unit"]) {
                const directory = path.join(root, "test", bucket);
                fs.mkdirSync(directory, { recursive: true });
                fs.writeFileSync(
                    path.join(directory, "one.test.ts"),
                    `describe("${bucket}", () => { it("works", () => {}); });`
                );
            }
            const tasks = discoverTasks(
                path.join(root, "test"),
                undefined,
                undefined,
                undefined,
                root
            ).tasks;
            expect(
                selectRunnerTests(tasks, {}, root).map(
                    (task: { fullTitle: string }) => task.fullTitle
                )
            ).to.have.members(["harness works", "unit works"]);
            expect(
                selectRunnerTests(tasks, { runnerTests: true }, root)
            ).to.equal(tasks);
            const selected = discoverTasks(
                path.join(root, "test"),
                undefined,
                undefined,
                "scripts/*.test.ts",
                root
            ).tasks;
            expect(
                selectRunnerTests(
                    selected,
                    { testPattern: "scripts/*.test.ts" },
                    root
                )
            ).to.equal(selected);
            expect(selected.map((task) => task.fullTitle)).to.deep.equal([
                "scripts works"
            ]);
            expect(selectRunnerTests(tasks, { grep: "works" }, root)).to.equal(
                tasks
            );
            expect(
                selectRunnerTests(
                    tasks,
                    { mochaTestPattern: "scripts/*.test.ts" },
                    root
                )
            ).to.equal(tasks);
            expect(
                selectRunnerTests(
                    tasks,
                    { forgeTestPattern: "**/*.t.sol" },
                    root
                )
            ).to.equal(tasks);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
    it("round-trips task paths under the project and rejects escapes", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "task-wire-"));
        try {
            const nested = path.join(root, "test", "nested file.test.ts");
            fs.mkdirSync(path.dirname(nested), { recursive: true });
            fs.writeFileSync(nested, "");
            const wire = toWireTask(
                { label: "nested", logName: "nested", args: ["test", nested] },
                root
            );
            expect(wire.args[1]).to.deep.equal({
                projectPath: "test/nested file.test.ts"
            });
            expect(fromWireTask(wire, root).args[1]).to.equal(nested);
            expect(() =>
                toWireTask(
                    {
                        label: "bad",
                        logName: "bad",
                        args: [path.dirname(root)]
                    },
                    root
                )
            ).to.throw(/leaves project/);
            expect(() =>
                fromWireTask(
                    { ...wire, args: [{ projectPath: "../bad" }] },
                    root
                )
            ).to.throw(/leaves extracted/);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

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

    it("supports a consumer-defined test filename pattern", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "mocha-pattern-"));
        const testDir = path.join(root, "test");
        fs.mkdirSync(testDir, { recursive: true });
        fs.writeFileSync(
            path.join(testDir, "consumer.spec.ts"),
            'describe("consumer", () => { it("runs", () => {}); });'
        );
        fs.writeFileSync(
            path.join(testDir, "other.ts"),
            'describe("other", () => { it("also runs", () => {}); });'
        );

        try {
            expect(
                discoverTasks(testDir).tasks.map((task) => task.fullTitle)
            ).to.deep.equal(["consumer runs", "other also runs"]);
            const { tasks } = discoverTasks(
                testDir,
                undefined,
                undefined,
                "**/*.spec.ts"
            );
            expect(tasks.map((task) => task.fullTitle)).to.deep.equal([
                "consumer runs"
            ]);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("enumerates substituted it titles into isolated tasks", function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "mocha-dynamic-it-")
        );
        const testDir = path.join(root, "test");
        const file = path.join(testDir, "dynamic.test.ts");
        fs.mkdirSync(testDir, { recursive: true });
        fs.writeFileSync(
            file,
            'describe("matrix", () => { for (const value of [1, 2]) it(`case ${value}`, () => {}); it("static", () => {}); });'
        );

        try {
            const { tasks } = discoverTasks(testDir);
            expect(tasks.map((task) => task.fullTitle)).to.have.members([
                "matrix case 1",
                "matrix case 2",
                "matrix static"
            ]);
            expect(tasks).to.have.lengthOf(3);
            expect(
                tasks.every((task) => task.args.includes("--grep"))
            ).to.equal(true);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("enumerates dynamic describe titles before applying --grep", function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "mocha-dynamic-describe-")
        );
        const testDir = path.join(root, "test");
        const file = path.join(testDir, "dynamic.test.ts");
        fs.mkdirSync(testDir, { recursive: true });
        fs.writeFileSync(
            file,
            'for (const value of [1, 2]) describe(`suite ${value}`, () => { it("runs", () => {}); });'
        );

        try {
            const { tasks } = discoverTasks(testDir, "suite 2");
            expect(tasks).to.have.lengthOf(1);
            expect(tasks[0].fullTitle).to.equal("suite 2 runs");
            expect(tasks[0].args).to.deep.equal([
                "test",
                "--no-compile",
                file,
                "--grep",
                "^suite 2 runs$"
            ]);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
    it("gives static and enumerated tests portable source and full-title identities", function () {
        const roots = [
            fs.mkdtempSync(path.join(os.tmpdir(), "identity-a-")),
            fs.mkdtempSync(path.join(os.tmpdir(), "identity-b-"))
        ];
        try {
            const identities = roots.map((root) => {
                const dir = path.join(root, "test");
                fs.mkdirSync(dir);
                fs.writeFileSync(
                    path.join(dir, "same.test.ts"),
                    'describe("outer",()=>{it("static",()=>{}); for(const x of [1,2]) it(`dynamic ${x}`,()=>{});});'
                );
                fs.mkdirSync(path.join(dir, "nested"));
                fs.writeFileSync(
                    path.join(dir, "nested", "same.test.ts"),
                    'describe("outer",()=>{it("static",()=>{});});'
                );
                const { tasks } = discoverTasks(
                    dir,
                    undefined,
                    path.join(dir, "e2e"),
                    "**/*.ts",
                    root
                );
                expect(
                    new Set(tasks.map((t: { identity: string }) => t.identity))
                        .size
                ).to.equal(4);
                for (const task of tasks) {
                    expect(toWireTask(task, root)).to.not.have.property(
                        "identity"
                    );
                }
                return tasks
                    .map((t: { identity: string }) => t.identity)
                    .sort();
            });
            expect(identities[0]).to.deep.equal(identities[1]);
            expect(identities[0]).to.include(
                JSON.stringify([
                    "hardhat",
                    "test/same.test.ts",
                    "outer dynamic 1"
                ])
            );
        } finally {
            roots.forEach((root) =>
                fs.rmSync(root, { recursive: true, force: true })
            );
        }
    });
});
