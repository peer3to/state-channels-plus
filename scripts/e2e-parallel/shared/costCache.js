/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const {
    COST_EWMA_ALPHA,
    DEFAULT_TASK_COST,
    STARVED_COST_FACTOR,
    MEASUREMENT_REASONS,
    DEFAULT_COST_CACHE_PATH,
    DEFAULT_COST_OVERRIDES_PATH,
    DEFAULT_COST_SNAPSHOT_PATH
} = require("./constants");
const { writeJsonAtomic } = require("./logging");
const { normalizeTaskRunner } = require("./taskRunners");

// 2: one default cost, no heavy tier or starvation history.
const CACHE_VERSION = 2;
const SAMPLE_FIELDS = ["durationMs", "avgCores", "peakRssGb"];
const OVERRIDE_FIELDS = ["durationMs", "cores", "rssGb"];
const numeric = (value) => Number.isFinite(value) && value >= 0;
const object = (value) =>
    value !== null && typeof value === "object" && !Array.isArray(value);
const reasons = new Set(MEASUREMENT_REASONS);

// Cost of a task nothing has measured: not known, so it waits for a tick.
function defaultCost() {
    return { ...DEFAULT_TASK_COST, known: false };
}

function validEntry(entry) {
    return (
        object(entry) &&
        numeric(entry.durationMs) &&
        ["peakRssGb", "avgCores"].every(
            (field) => entry[field] === null || numeric(entry[field])
        ) &&
        Number.isInteger(entry.samples) &&
        entry.samples >= 1 &&
        typeof entry.lastSeenAt === "string" &&
        (entry.measurementReason == null ||
            reasons.has(entry.measurementReason)) &&
        (![entry.peakRssGb, entry.avgCores].includes(null) ||
            reasons.has(entry.measurementReason))
    );
}

function readCache(cachePath, onDenied) {
    try {
        const data = JSON.parse(fs.readFileSync(cachePath, "utf8"));
        if (
            !object(data) ||
            data.version !== CACHE_VERSION ||
            !object(data.tasks) ||
            !Object.values(data.tasks).every(validEntry)
        )
            throw new SyntaxError("Invalid cost cache schema");
        return data.tasks;
    } catch (error) {
        if (error.code === "ENOENT") return {};
        console.warn(
            `Unable to read cost cache ${cachePath}; starting cold: ${error.message}`
        );
        if (error instanceof SyntaxError) return {};
        onDenied(error);
        return {};
    }
}

// A broken overrides file fails the run, so a stale entry gets fixed rather
// than silently ignored.
function readOverrides(overridesPath) {
    let text;
    try {
        text = fs.readFileSync(overridesPath, "utf8");
    } catch (error) {
        if (error.code === "ENOENT") return {};
        throw error;
    }
    let overrides;
    try {
        overrides = JSON.parse(text);
    } catch (error) {
        throw new Error(
            `Invalid cost overrides ${overridesPath}: ${error.message}`
        );
    }
    if (!object(overrides))
        throw new Error(
            `Invalid cost overrides ${overridesPath}: not a JSON object`
        );
    for (const [key, entry] of Object.entries(overrides)) {
        if (
            !object(entry) ||
            Object.entries(entry).some(
                ([field, value]) =>
                    !OVERRIDE_FIELDS.includes(field) || !numeric(value)
            )
        )
            throw new Error(
                `Invalid cost overrides ${overridesPath}: entry ${JSON.stringify(key)} may hold only non-negative ${OVERRIDE_FIELDS.join(", ")}`
            );
    }
    return overrides;
}

// An unmeasured run (null) keeps what earlier runs measured.
function EWMA(previous, next) {
    if (next === null || next === undefined) return previous ?? null;
    if (previous === null || previous === undefined) return next;
    return previous + COST_EWMA_ALPHA * (next - previous);
}

function executed(attempt, metadata) {
    return (
        !attempt.cancelled &&
        !attempt.infrastructureFailure &&
        !attempt.signal &&
        ["complete", "late-failure", "retry-starvation"].includes(
            metadata.disposition
        )
    );
}

// Every executed attempt is a sample; the run keeps its last one, so a clean
// retry replaces the inflated sample of the attempt that starved.
function isCostSample(attempt, metadata) {
    return executed(attempt, metadata) && numeric(attempt.durationMs);
}

class CostCache {
    constructor({
        projectRoot = process.cwd(),
        cachePath = DEFAULT_COST_CACHE_PATH,
        overridesPath = DEFAULT_COST_OVERRIDES_PATH,
        snapshotPath = DEFAULT_COST_SNAPSHOT_PATH,
        readOnly = false
    } = {}) {
        this.projectRoot = path.resolve(projectRoot);
        this.cachePath = path.resolve(this.projectRoot, cachePath);
        // CI reads the costs and never writes them, so it stays stateless.
        this.readOnly = readOnly;
        // commit() re-reads the file and refuses to replace one it cannot read.
        this.tasks = readCache(this.cachePath, () => {});
        // Committed costs for the tests this checkout has not measured yet.
        this.snapshot = readCache(
            path.resolve(this.projectRoot, snapshotPath),
            () => {}
        );
        this.overrides = readOverrides(
            path.resolve(this.projectRoot, overridesPath)
        );
        this.pending = new Map();
        // Running sums of this run's samples per source file (`runner|file|`),
        // so a sibling mean costs the same however many tasks are pending.
        this.fileSums = new Map();
        // Per source file: bumped whenever a resolve() in that file may change.
        this.fileRevisions = new Map();
        // Bumped by commit(), which changes every resolve().
        this.generation = 0;
        // Task object -> its cache key and source-file prefix (`runner|file|`);
        // keys cost two path operations each.
        this.keys = new WeakMap();
    }

    key(task) {
        return this.identify(task).key;
    }

    // The prefix comes from runner and file only: a title may contain "|".
    filePrefix(task) {
        return this.identify(task).prefix;
    }

    identify(task) {
        const known = this.keys.get(task);
        if (known) return known;
        const runner = normalizeTaskRunner(task.runner);
        let file = task.sourceFile;
        if (runner === "browser") {
            const index = task.args?.indexOf("--script") ?? -1;
            file = index >= 0 ? task.args[index + 1] : undefined;
        } else if (runner === "hardhat") {
            file = task.args?.find((arg) => /\.(?:[cm]?js|ts)$/.test(arg));
        }
        let relative = file
            ? path
                  .relative(
                      this.projectRoot,
                      path.resolve(this.projectRoot, file)
                  )
                  .split(path.sep)
                  .join("/")
            : "";
        if (
            runner === "hardhat" &&
            relative.startsWith("dist/test/") &&
            relative.endsWith(".js")
        )
            relative = `${relative.slice(5, -3)}.ts`;
        const prefix = `${runner}|${relative}|`;
        const identity = {
            key: `${prefix}${task.fullTitle ?? task.label}`,
            prefix
        };
        this.keys.set(task, identity);
        return identity;
    }

    /** Changes whenever resolve(task) may return something different. */
    revision(task) {
        return `${this.generation}:${this.fileRevisions.get(this.filePrefix(task)) ?? 0}`;
    }

    record(task, attempt, metadata) {
        if (!isCostSample(attempt, metadata)) return;
        const pending = this.pendingFor(this.key(task));
        const inflate = (value) =>
            value === null || value === undefined
                ? null
                : metadata.starveCount > 0
                  ? value * STARVED_COST_FACTOR
                  : value;
        const peakRssGb = inflate(attempt.peakRssGb);
        const avgCores = inflate(attempt.avgCores);
        if (pending.sample) this.addToFileSums(task, pending.sample, -1);
        pending.sample = {
            durationMs: attempt.durationMs,
            peakRssGb,
            avgCores,
            measurementReason:
                attempt.measurementReason ??
                (peakRssGb === null || avgCores === null
                    ? "legacy-measurements-unavailable"
                    : null)
        };
        this.addToFileSums(task, pending.sample, 1);
        pending.at = metadata.at ?? new Date().toISOString();
        this.touch(task);
    }

    pendingFor(key) {
        let pending = this.pending.get(key);
        if (!pending) {
            pending = { sample: null };
            this.pending.set(key, pending);
        }
        return pending;
    }

    touch(task) {
        const prefix = this.filePrefix(task);
        this.fileRevisions.set(
            prefix,
            (this.fileRevisions.get(prefix) ?? 0) + 1
        );
    }

    addToFileSums(task, sample, sign) {
        const prefix = this.filePrefix(task);
        let sums = this.fileSums.get(prefix);
        if (!sums) {
            sums = Object.fromEntries(
                SAMPLE_FIELDS.map((field) => [field, { sum: 0, count: 0 }])
            );
            this.fileSums.set(prefix, sums);
        }
        for (const field of SAMPLE_FIELDS) {
            if (!numeric(sample[field])) continue;
            sums[field].sum += sign * sample[field];
            sums[field].count += sign;
        }
    }

    siblingMean(task) {
        const sums = this.fileSums.get(this.filePrefix(task));
        if (!sums) return null;
        const mean = Object.fromEntries(
            SAMPLE_FIELDS.map((field) => [
                field,
                sums[field].count > 0
                    ? sums[field].sum / sums[field].count
                    : null
            ])
        );
        return mean.durationMs === null ? null : mean;
    }

    resolve(task) {
        const key = this.key(task);
        const measured =
            this.pending.get(key)?.sample ??
            this.tasks[key] ??
            this.snapshot[key];
        const entry = measured ?? this.siblingMean(task);
        const fallback = defaultCost();
        const override = this.overrides[key] ?? {};
        const cores = override.cores ?? entry?.avgCores ?? fallback.cores;
        const rssGb = override.rssGb ?? entry?.peakRssGb ?? fallback.rssGb;
        return {
            durationMs:
                override.durationMs ?? entry?.durationMs ?? fallback.durationMs,
            cores,
            rssGb,
            // Measured or overridden cores and memory, not a default or a
            // sibling's: a worker may start it without waiting for a tick.
            known:
                (override.cores !== undefined || numeric(measured?.avgCores)) &&
                (override.rssGb !== undefined || numeric(measured?.peakRssGb))
        };
    }

    // Persisting is best effort: a cache that cannot be read or written warns
    // and keeps this run's measurements pending, and never fails the run.
    commit({ interrupted = false } = {}) {
        if (interrupted || this.readOnly || !this.pending.size) return;
        // Merge into the file as it is now: another run from this checkout may
        // have committed since this one started.
        let readDenied = null;
        const tasks = readCache(this.cachePath, (error) => {
            readDenied = error;
        });
        if (readDenied) {
            console.warn(
                `Not committing cost cache ${this.cachePath}: it could not be read (${readDenied.message})`
            );
            return;
        }
        for (const [key, { sample, at }] of this.pending) {
            // The snapshot seeds a test this checkout has not measured yet.
            const old = tasks[key] ?? this.snapshot[key] ?? null;
            const entry = Object.fromEntries(
                SAMPLE_FIELDS.map((field) => [
                    field,
                    EWMA(old?.[field], sample[field])
                ])
            );
            entry.measurementReason = [
                entry.peakRssGb,
                entry.avgCores
            ].includes(null)
                ? (sample.measurementReason ??
                  "legacy-measurements-unavailable")
                : null;
            entry.samples = (old?.samples ?? 0) + 1;
            entry.lastSeenAt = at;
            tasks[key] = entry;
        }
        try {
            writeJsonAtomic(this.cachePath, { version: CACHE_VERSION, tasks });
        } catch (error) {
            console.warn(`Unable to commit cost cache: ${error.message}`);
            return;
        }
        this.tasks = tasks;
        this.pending.clear();
        this.fileSums.clear();
        this.fileRevisions.clear();
        this.generation++;
    }
}

/**
 * Merge this checkout's measured costs into the committed snapshot, rounded
 * and sorted by key so a refresh diffs only what changed. Returns the number
 * of tasks written.
 */
function refreshSnapshot({
    projectRoot = process.cwd(),
    cachePath = DEFAULT_COST_CACHE_PATH,
    snapshotPath = DEFAULT_COST_SNAPSHOT_PATH
} = {}) {
    const root = path.resolve(projectRoot);
    const refuse = (error) => {
        throw error;
    };
    const target = path.resolve(root, snapshotPath);
    const tasks = {
        ...readCache(target, refuse),
        ...readCache(path.resolve(root, cachePath), refuse)
    };
    const round = (value, places) =>
        value === null ? null : Number(value.toFixed(places));
    const sorted = Object.fromEntries(
        Object.keys(tasks)
            .sort()
            .map((key) => {
                const entry = tasks[key];
                return [
                    key,
                    {
                        ...entry,
                        durationMs: Math.round(entry.durationMs),
                        avgCores: round(entry.avgCores, 3),
                        peakRssGb: round(entry.peakRssGb, 3)
                    }
                ];
            })
    );
    writeJsonAtomic(target, { version: CACHE_VERSION, tasks: sorted });
    return Object.keys(sorted).length;
}

module.exports = { CostCache, defaultCost, refreshSnapshot };
