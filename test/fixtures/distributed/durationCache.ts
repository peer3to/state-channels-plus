// @spec-test-coverage-ignore: repository-local runner scheduling and diagnostics
import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { stripVTControlCharacters } from "util";
const {
    DurationCache,
    taskIdentity
} = require("../../../scripts/e2e-parallel/shared/durationCache");
const {
    TaskCoordinator,
    reduceAttemptOutput
} = require("../../../scripts/e2e-parallel/shared/taskCoordinator");
const {
    publishDistributedDurationCache
} = require("../../../scripts/test-e2e-parallel");

export type CacheAttempt = {
    workerId: string;
    disposition: string;
    code: number;
    durationMs?: number;
    cancelled?: boolean;
    infrastructureFailure?: boolean;
    starved?: boolean;
    oom?: boolean;
};
export type CacheTask = {
    identity: string;
    label: string;
    logName: string;
    args: string[];
    runner: string;
    attempts?: CacheAttempt[];
};

export function cacheTask(name: string): CacheTask {
    return {
        identity: taskIdentity(
            "hardhat",
            path.resolve("test", name + ".test.ts"),
            name
        ),
        label: name,
        logName: name,
        args: [],
        runner: "hardhat"
    };
}

export function completedTask(
    name: string,
    code = 0,
    durationMs = 100
): CacheTask {
    const task = cacheTask(name);
    const coordinator = new TaskCoordinator([task]);
    const assignment = coordinator.requestTask("server-3");
    coordinator.completeAttempt("server-3", {
        attemptId: assignment.attemptId,
        code,
        durationMs
    });
    return task;
}

export class DurationCacheFixture {
    readonly root = fs.mkdtempSync(path.join(os.tmpdir(), "duration-cache-"));
    readonly file = path.join(this.root, "duration-cache.json");
    readonly warnings: string[] = [];
    open(enabled = true, configurationKey = "default", file = this.file) {
        return new DurationCache({
            file,
            enabled,
            configurationKey,
            warn: (message: string) => this.warnings.push(message)
        });
    }
    save(tasks: CacheTask[]) {
        this.open().publish(tasks);
    }
    read() {
        return JSON.parse(fs.readFileSync(this.file, "utf8"));
    }
    publish(tasks: CacheTask[], completed: number, signal = 0, enabled = true) {
        const stats = {
            completed,
            failed: tasks.filter((task) =>
                task.attempts?.some((attempt) => attempt.code !== 0)
            )
        };
        publishDistributedDurationCache(
            this.open(enabled),
            tasks,
            stats,
            signal
        );
        return stats;
    }
    close() {
        fs.chmodSync(this.root, 0o700);
        fs.rmSync(this.root, { recursive: true, force: true });
    }
}

export function starvedOutput() {
    return { ...reduceAttemptOutput(), starveCount: 1 };
}

export function attemptSequence(
    options: { frontStarvationRetry?: boolean; speculative?: boolean } = {}
) {
    const tasks = [cacheTask("long"), cacheTask("short"), cacheTask("tiny")];
    const coordinator = new TaskCoordinator(tasks, options);
    const complete = (
        workerId: string,
        assignment: { attemptId: string },
        extra: Record<string, unknown> = {}
    ) =>
        coordinator.completeAttempt(workerId, {
            attemptId: assignment.attemptId,
            code: 0,
            durationMs: 30,
            ...extra
        });
    const starved = starvedOutput();
    return { tasks, coordinator, complete, starved };
}

export async function publishChild(file: string, name: string) {
    const modulePath = path.resolve(
        "scripts/e2e-parallel/shared/durationCache.js"
    );
    const task = completedTask(name);
    const child = spawn(
        process.execPath,
        [
            "-e",
            `const {DurationCache}=require(process.argv[1]); const cache=new DurationCache({file:process.argv[2],configurationKey:'default'}); cache.publish(JSON.parse(process.argv[3])); process.stdout.write(JSON.stringify({version:1,records:Object.fromEntries(cache.records)}));`,
            modulePath,
            file,
            JSON.stringify([task])
        ],
        { stdio: "pipe" }
    );
    let output = "";
    child.stdout.on("data", (chunk) => {
        output += chunk.toString();
    });
    await new Promise<void>((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code) =>
            code === 0
                ? resolve()
                : reject(new Error(`cache writer exit ${code}`))
        );
    });
    return JSON.parse(output);
}

export function captureRunnerOutput(action: () => void) {
    const lines: string[] = [];
    const original = console.log;
    console.log = (...values: unknown[]) => {
        lines.push(stripVTControlCharacters(values.map(String).join(" ")));
    };
    try {
        action();
        return lines.join("\n");
    } finally {
        console.log = original;
    }
}

export function attributionSummary(
    kind: "fail" | "oom" | "recovered" | "repeated" | "infra" | "local"
) {
    const task = cacheTask("attributed");
    const co = new TaskCoordinator([task]);
    const first = co.requestTask("a");
    const reduced = {
        ...reduceAttemptOutput(),
        starveCount: ["recovered", "repeated"].includes(kind) ? 1 : 0,
        oomCount: kind === "oom" ? 1 : 0
    };
    co.completeAttempt("a", {
        attemptId: first.attemptId,
        code: 1,
        durationMs: 1,
        reduced,
        infrastructureFailure: kind === "infra" ? "disk" : undefined
    });
    if (["recovered", "repeated", "infra"].includes(kind)) {
        const retry = co.requestTask("b");
        co.completeAttempt("b", {
            attemptId: retry.attemptId,
            code: kind === "recovered" ? 0 : 1,
            durationMs: 2,
            reduced: {
                ...reduceAttemptOutput(),
                starveCount: kind === "repeated" ? 1 : 0
            },
            infrastructureFailure: kind === "infra" ? "disk" : undefined
        });
    }
    return captureRunnerOutput(() =>
        require("../../../scripts/e2e-parallel/shared/logging").summary({
            tasks: [task],
            failed: co.finish().failed,
            wallMs: 10,
            sumDurationMs: 3,
            peakCpu: 0,
            avgCpu: 0,
            peakOccupiedGb: 0,
            avgPerTestGb: 0,
            memBoundGb: 1,
            targetLoad: 1,
            labelFor:
                kind === "local"
                    ? undefined
                    : (worker: string) =>
                          worker === "a" ? "server-3" : "server-8"
        })
    );
}
