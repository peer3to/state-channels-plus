/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");

function taskIdentity(runner, file, title, projectRoot = process.cwd()) {
    return JSON.stringify([
        runner,
        path
            .relative(projectRoot, path.resolve(file))
            .split(path.sep)
            .join("/"),
        title
    ]);
}

function spreadRankedTasks({ tasks, rankingApplied }) {
    if (!rankingApplied) return tasks;
    const forge = tasks.filter((task) => task.runner === "forge");
    const remaining = tasks.filter((task) => task.runner !== "forge");
    const half = Math.ceil(remaining.length / 2);
    for (let i = half - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
    }
    return [...forge, ...remaining];
}

function validDuration(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function validRecord(record) {
    return (
        record &&
        typeof record === "object" &&
        ["pass", "fail"].includes(record.lastOutcome) &&
        typeof record.configurationKey === "string" &&
        validDuration(record.updatedAt) &&
        [record.lastAttemptDurationMs, record.estimatedDurationMs].every(
            (value) => value === undefined || validDuration(value)
        ) &&
        (record.estimateFromSuccess === undefined ||
            typeof record.estimateFromSuccess === "boolean")
    );
}

class DurationCache {
    constructor({
        file,
        configurationKey,
        enabled = true,
        warn = console.warn
    }) {
        this.file = file;
        this.configurationKey = configurationKey;
        this.enabled = enabled;
        this.warn = warn;
        this.warned = false;
        this.loaded = false;
        // Keys are portable discovered task identities; values are last-run records.
        this.records = new Map();
        if (!enabled) return;
        try {
            const data = JSON.parse(fs.readFileSync(file, "utf8"));
            if (
                data?.version !== 1 ||
                !data.records ||
                typeof data.records !== "object" ||
                Array.isArray(data.records)
            ) {
                throw new Error("unsupported or malformed duration cache");
            }
            this.records = new Map(
                Object.entries(data.records).filter(([, record]) =>
                    validRecord(record)
                )
            );
            this.loaded = true;
        } catch (error) {
            if (error.code !== "ENOENT") this.warning(error);
        }
    }

    warning(error) {
        if (this.warned) return;
        this.warned = true;
        this.warn(`Duration cache: ${error.message}`);
    }

    rank(tasks) {
        if (!this.enabled || !this.loaded)
            return { tasks, rankingApplied: false };
        const ranked = tasks.map((task, index) => {
            const saved = this.records.get(task.identity);
            const record =
                saved?.configurationKey === this.configurationKey
                    ? saved
                    : undefined;
            return {
                task,
                index,
                record,
                tier: !record ? 0 : record.lastOutcome === "fail" ? 1 : 2
            };
        });
        ranked.sort((a, b) => {
            if (a.tier !== b.tier) return a.tier - b.tier;
            if (a.tier === 0) return a.index - b.index;
            const left = a.record.estimatedDurationMs;
            const right = b.record.estimatedDurationMs;
            if (left === undefined || right === undefined) {
                if (left !== right) return left === undefined ? -1 : 1;
            } else if (left !== right) return right - left;
            return a.index - b.index;
        });
        return {
            tasks: ranked.map((entry) => entry.task),
            rankingApplied: true
        };
    }

    publish(tasks) {
        if (!this.enabled || !tasks.length) return;
        const records = new Map(this.records);
        for (const task of tasks) {
            if (typeof task.identity !== "string") continue;
            const previous = records.get(task.identity);
            let record =
                previous?.configurationKey === this.configurationKey
                    ? { ...previous }
                    : undefined;
            for (const attempt of task.attempts || []) {
                if (
                    attempt.cancelled ||
                    !["complete", "late-failure"].includes(attempt.disposition)
                )
                    continue;
                record ||= { configurationKey: this.configurationKey };
                record.lastOutcome = attempt.code === 0 ? "pass" : "fail";
                record.updatedAt = Date.now();
                if (validDuration(attempt.durationMs)) {
                    record.lastAttemptDurationMs = attempt.durationMs;
                    if (
                        !attempt.starved &&
                        !attempt.infrastructureFailure &&
                        !attempt.oom
                    ) {
                        if (attempt.code === 0 || !record.estimateFromSuccess) {
                            record.estimatedDurationMs = attempt.durationMs;
                            record.estimateFromSuccess = attempt.code === 0;
                        }
                    }
                }
            }
            if (record) records.set(task.identity, record);
        }
        let temporary;
        let descriptor;
        let created = false;
        try {
            const encoded =
                JSON.stringify({
                    version: 1,
                    records: Object.fromEntries(records)
                }) + "\n";
            fs.mkdirSync(path.dirname(this.file), { recursive: true });
            temporary = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
            descriptor = fs.openSync(temporary, "wx", 0o600);
            created = true;
            fs.writeFileSync(descriptor, encoded);
            fs.closeSync(descriptor);
            descriptor = undefined;
            fs.renameSync(temporary, this.file);
            this.records = records;
        } catch (error) {
            if (descriptor !== undefined) {
                try {
                    fs.closeSync(descriptor);
                } catch {
                    /* Keep the original publication error. */
                }
            }
            if (created) {
                try {
                    fs.rmSync(temporary, { force: true });
                } catch {
                    /* Optional cache cleanup must not fail the gate. */
                }
            }
            this.warning(error);
        }
    }
}

module.exports = {
    DurationCache,
    taskIdentity,
    validDuration,
    spreadRankedTasks
};
