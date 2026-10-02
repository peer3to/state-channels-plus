/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const {
    COST_EWMA_ALPHA,
    HEAVY_STARVE_RUNS,
    HEAVY_EL_MS,
    HEAVY_CORES,
    HEAVY_RSS_GB,
    COLD_COSTS,
    MEASUREMENT_REASONS,
    DEFAULT_COST_CACHE_PATH,
    DEFAULT_COST_OVERRIDES_PATH
} = require("./constants");
const { writeJsonAtomic } = require("./logging");
const { normalizeTaskRunner, requiresBrowser } = require("./taskRunners");

const SAMPLE_FIELDS = ["durationMs", "avgCores", "peakRssGb", "peakElMs"];
const numeric = (value) => Number.isFinite(value) && value >= 0;
const object = (value) =>
    value !== null && typeof value === "object" && !Array.isArray(value);
const reasons = new Set(MEASUREMENT_REASONS);

function coldCost(task) {
    if (requiresBrowser(task)) return { ...COLD_COSTS.heavy };
    if (normalizeTaskRunner(task.runner) === "hardhat" && task.isE2E)
        return { ...COLD_COSTS.medium };
    return { ...COLD_COSTS.light };
}

function validEntry(entry) {
    return (
        object(entry) &&
        ["durationMs", "peakRssGb", "avgCores"].every(
            (field) => entry[field] === null || numeric(entry[field])
        ) &&
        numeric(entry.peakElMs) &&
        Number.isInteger(entry.samples) &&
        entry.samples >= 0 &&
        typeof entry.lastSeenAt === "string" &&
        (entry.measurementReason == null ||
            reasons.has(entry.measurementReason)) &&
        (![entry.durationMs, entry.peakRssGb, entry.avgCores].includes(null) ||
            reasons.has(entry.measurementReason)) &&
        Array.isArray(entry.starvations) &&
        entry.starvations.every(
            (event) =>
                object(event) &&
                typeof event.server === "string" &&
                typeof event.at === "string"
        ) &&
        Array.isArray(entry.recentRuns) &&
        entry.recentRuns.every(
            (run) =>
                object(run) &&
                typeof run.at === "string" &&
                typeof run.starved === "boolean"
        )
    );
}

function readCache(cachePath, onDenied) {
    try {
        const data = JSON.parse(fs.readFileSync(cachePath, "utf8"));
        if (
            !object(data) ||
            data.version !== 1 ||
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

// A broken overrides file must not fail a run: it is ignored, loudly.
function readOverrides(overridesPath) {
    let overrides;
    try {
        overrides = JSON.parse(fs.readFileSync(overridesPath, "utf8"));
    } catch (error) {
        if (error.code === "ENOENT") return {};
        console.warn(
            `Unable to read cost overrides ${overridesPath}; ignoring them: ${error.message}`
        );
        return {};
    }
    if (
        !object(overrides) ||
        Object.values(overrides).some(
            (entry) =>
                !object(entry) ||
                Object.entries(entry).some(([field, value]) =>
                    field === "heavy"
                        ? typeof value !== "boolean"
                        : !["durationMs", "rssGb", "cores"].includes(field) ||
                          !numeric(value)
                )
        )
    ) {
        console.warn(`Invalid cost overrides ${overridesPath}; ignoring them`);
        return {};
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

// The attempt that finalized the task, unstarved, is the run's one sample (D11).
function isCostSample(attempt, metadata) {
    return (
        executed(attempt, metadata) &&
        metadata.disposition !== "retry-starvation" &&
        metadata.starveCount === 0 &&
        numeric(attempt.durationMs)
    );
}

class CostCache {
    constructor({
        projectRoot = process.cwd(),
        cachePath = DEFAULT_COST_CACHE_PATH,
        overridesPath = DEFAULT_COST_OVERRIDES_PATH
    } = {}) {
        this.projectRoot = path.resolve(projectRoot);
        this.cachePath = path.resolve(this.projectRoot, cachePath);
        this.readDenied = null;
        this.tasks = readCache(this.cachePath, (error) => {
            this.readDenied = error;
        });
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
        const key = this.key(task);
        if (executed(attempt, metadata) && metadata.starveCount > 0) {
            const pending = this.pendingFor(key);
            pending.starved = true;
            pending.at = metadata.at ?? new Date().toISOString();
            pending.starvations.push({
                server: metadata.server,
                at: pending.at
            });
            this.touch(task);
        }
        if (!isCostSample(attempt, metadata)) return;
        const pending = this.pendingFor(key);
        const peakRssGb = attempt.peakRssGb ?? null;
        const avgCores = attempt.avgCores ?? null;
        if (pending.sample) this.addToFileSums(task, pending.sample, -1);
        pending.sample = {
            durationMs: attempt.durationMs,
            peakRssGb,
            avgCores,
            peakElMs: attempt.peakElMs ?? 0,
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
            pending = { sample: null, starvations: [], starved: false };
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
        const key = this.key(task);
        const sums = this.fileSums.get(this.filePrefix(task));
        if (!sums) return null;
        const own = this.pending.get(key)?.sample;
        const mean = Object.fromEntries(
            SAMPLE_FIELDS.map((field) => {
                const ownValue = own && numeric(own[field]) ? own[field] : null;
                const count = sums[field].count - (ownValue === null ? 0 : 1);
                return [
                    field,
                    count > 0
                        ? (sums[field].sum - (ownValue ?? 0)) / count
                        : null
                ];
            })
        );
        return mean.durationMs === null ? null : mean;
    }

    resolve(task) {
        const key = this.key(task);
        const pending = this.pending.get(key);
        const entry =
            pending?.sample ?? this.tasks[key] ?? this.siblingMean(task);
        const cold = coldCost(task);
        const override = this.overrides[key] ?? {};
        const cost = {
            durationMs:
                override.durationMs ?? entry?.durationMs ?? cold.durationMs,
            cores: override.cores ?? entry?.avgCores ?? cold.cores,
            rssGb: override.rssGb ?? entry?.peakRssGb ?? cold.rssGb
        };
        const starved =
            pending?.starved ||
            this.tasks[key]?.recentRuns
                .slice(-HEAVY_STARVE_RUNS)
                .some((run) => run.starved);
        const measured =
            entry ||
            override.cores !== undefined ||
            override.rssGb !== undefined;
        const overThreshold = measured
            ? (entry?.peakElMs ?? 0) > HEAVY_EL_MS ||
              cost.cores > HEAVY_CORES ||
              cost.rssGb > HEAVY_RSS_GB
            : cold.heavy;
        // An explicit override `heavy` wins over every computed trigger (D9).
        return {
            ...cost,
            heavy: override.heavy ?? (!!starved || overThreshold)
        };
    }

    // Persisting is best effort: a cache that cannot be read or written warns
    // and keeps this run's measurements pending, and never fails the run.
    commit({ interrupted = false } = {}) {
        if (interrupted || !this.pending.size) return;
        if (this.readDenied) {
            console.warn(
                `Not committing cost cache ${this.cachePath}: it could not be read (${this.readDenied.message})`
            );
            return;
        }
        const tasks = { ...this.tasks };
        for (const [key, pending] of this.pending) {
            const old = tasks[key] ?? null;
            const sample = pending.sample;
            const entry = {
                ...(old || {
                    durationMs: null,
                    peakRssGb: null,
                    avgCores: null,
                    peakElMs: 0,
                    samples: 0,
                    measurementReason: "process-sampling-unavailable",
                    starvations: [],
                    recentRuns: []
                })
            };
            if (sample) {
                for (const field of SAMPLE_FIELDS)
                    entry[field] = EWMA(old?.[field], sample[field]);
                entry.measurementReason = [
                    entry.peakRssGb,
                    entry.avgCores
                ].includes(null)
                    ? (sample.measurementReason ??
                      "legacy-measurements-unavailable")
                    : null;
                entry.samples++;
            }
            entry.lastSeenAt = pending.at;
            entry.starvations = [...entry.starvations, ...pending.starvations];
            entry.recentRuns = [
                ...entry.recentRuns,
                { at: pending.at, starved: pending.starved }
            ].slice(-HEAVY_STARVE_RUNS);
            tasks[key] = entry;
        }
        try {
            writeJsonAtomic(this.cachePath, { version: 1, tasks });
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

module.exports = { CostCache, coldCost };
