/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const {
    DEFAULT_TASK_COST,
    STARVED_COST_FACTOR,
    MEASUREMENT_REASONS,
    DEFAULT_COST_CACHE_PATH,
    DEFAULT_COSTS_PATH,
    DEFAULT_COST_OVERRIDES_PATH
} = require("./constants");
const { writeJsonAtomic } = require("./logging");
const { normalizeTaskRunner } = require("./taskRunners");

// 3: each test's latest measurement; scheduling reads the committed costs.
const CACHE_VERSION = 3;
// Committed measurements, with a marker for temporary starvation inflation.
const COSTS_VERSION = 1;
const SAMPLE_FIELDS = ["durationMs", "avgCores", "peakRssGb"];
const OVERRIDE_FIELDS = ["durationMs", "cores", "rssGb"];
const numeric = (value) => Number.isFinite(value) && value >= 0;
const object = (value) =>
    value !== null && typeof value === "object" && !Array.isArray(value);
const reasons = new Set(MEASUREMENT_REASONS);

// Cost of a task nothing has measured.
function defaultCost() {
    return { ...DEFAULT_TASK_COST, known: false };
}

function validCost(entry) {
    return (
        object(entry) &&
        numeric(entry.durationMs) &&
        (entry.starved === undefined || typeof entry.starved === "boolean") &&
        ["peakRssGb", "avgCores"].every(
            (field) => entry[field] === null || numeric(entry[field])
        ) &&
        (entry.measurementReason == null ||
            reasons.has(entry.measurementReason)) &&
        (![entry.peakRssGb, entry.avgCores].includes(null) ||
            reasons.has(entry.measurementReason))
    );
}

function validEntry(entry) {
    return (
        validCost(entry) &&
        Number.isInteger(entry.samples) &&
        entry.samples >= 1 &&
        typeof entry.lastSeenAt === "string"
    );
}

const CACHE_FORMAT = { version: CACHE_VERSION, valid: validEntry };
const COSTS_FORMAT = { version: COSTS_VERSION, valid: validCost };

// Every failure but a missing file goes to `onError`; the caller decides
// whether to start cold, skip the write, or stop.
function readCache(cachePath, onError, format = CACHE_FORMAT) {
    try {
        const data = JSON.parse(fs.readFileSync(cachePath, "utf8"));
        if (
            !object(data) ||
            data.version !== format.version ||
            !object(data.tasks) ||
            !Object.values(data.tasks).every(format.valid)
        )
            throw new SyntaxError("Invalid cost cache schema");
        return data.tasks;
    } catch (error) {
        if (error.code === "ENOENT") return {};
        onError(error);
        return {};
    }
}

// The committed form of a measurement: rounded so an unchanged cost diffs as
// unchanged. A value the measurement lacks keeps the committed one.
function committedCost(sample, previous) {
    const round = (value) => Number(value.toFixed(3));
    const pick = (field) =>
        numeric(sample[field])
            ? round(sample[field])
            : (previous?.[field] ?? null);
    const avgCores = pick("avgCores");
    const peakRssGb = pick("peakRssGb");
    return {
        ...(sample.starved ? { starved: true } : {}),
        durationMs: Math.round(sample.durationMs),
        avgCores,
        peakRssGb,
        measurementReason: [avgCores, peakRssGb].includes(null)
            ? (sample.measurementReason ?? "legacy-measurements-unavailable")
            : null
    };
}

function writeCosts(costsPath, tasks) {
    const sorted = Object.fromEntries(
        Object.keys(tasks)
            .sort()
            .map((key) => [key, tasks[key]])
    );
    writeJsonAtomic(costsPath, { version: COSTS_VERSION, tasks: sorted });
}

function startCold(cachePath) {
    return (error) =>
        console.warn(
            `Unable to read cost cache ${cachePath}; starting cold: ${error.message}`
        );
}

// A broken overrides file fails the run, so a stale entry gets fixed rather
// than silently ignored.
function readOverrides(overridesPath) {
    let text;
    try {
        text = fs.readFileSync(overridesPath, "utf8");
    } catch (error) {
        if (error.code === "ENOENT") return {};
        throw new Error(
            `Unable to read cost overrides ${overridesPath}: ${error.message}`
        );
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

// Every attempt whose result the run keeps is a sample, starved ones
// included; the run keeps its last one, so a clean retry replaces the
// inflated sample of the attempt that starved. A speculative copy that
// finishes after its task settled counts only when it fails the task (a
// late failure); a redundant copy never reaches the cache.
function isCostSample(attempt, metadata) {
    return executed(attempt, metadata) && numeric(attempt.durationMs);
}

// Inspect source independently of run selection. Unknown/dynamic definitions and
// unreadable sources are retained rather than mistaken for deleted tests.
function deletedCostChecker(projectRoot) {
    const files = new Map();
    return (key) => {
        const [runner, relative, ...titleParts] = key.split("|");
        if (!["hardhat", "forge", "browser"].includes(runner) || !relative)
            return false;
        const file = path.resolve(projectRoot, relative);
        const identity = runner + "|" + file;
        if (!files.has(identity)) {
            let titles = null;
            try {
                try {
                    fs.statSync(file);
                } catch (error) {
                    if (error.code !== "ENOENT") throw error;
                    files.set(identity, new Set());
                    return true;
                }
                if (runner === "hardhat") {
                    const {
                        readMochaTestInventory
                    } = require("./taskDiscovery");
                    const inventory = readMochaTestInventory(file);
                    if (inventory.malformed)
                        throw new Error(
                            `Cannot inspect malformed test source: ${file}`
                        );
                    const found = inventory.all;
                    if (!found.requiresFileFallback)
                        titles = new Set(
                            found.tests.map((test) => test.fullTitle)
                        );
                } else if (runner === "forge") {
                    const {
                        extractForgeTestContracts
                    } = require("./forgeTaskDiscovery");
                    titles = new Set(extractForgeTestContracts(file));
                }
            } catch (error) {
                console.warn(`Keeping costs for ${relative}: ${error.message}`);
            }
            files.set(identity, titles);
        }
        const titles = files.get(identity);
        return titles !== null && !titles.has(titleParts.join("|"));
    };
}

class CostCache {
    constructor({
        projectRoot = process.cwd(),
        cachePath = DEFAULT_COST_CACHE_PATH,
        costsPath = DEFAULT_COSTS_PATH,
        overridesPath = DEFAULT_COST_OVERRIDES_PATH,
        readOnly = false
    } = {}) {
        this.projectRoot = path.resolve(projectRoot);
        // Each test's latest measurement; scheduling never reads it.
        this.cachePath = path.resolve(this.projectRoot, cachePath);
        // CI reads the costs and never writes them, so it stays stateless.
        this.readOnly = readOnly;
        // The committed costs a run schedules by; commit() re-reads the file.
        this.costsPath = path.resolve(this.projectRoot, costsPath);
        this.costs = readCache(
            this.costsPath,
            startCold(this.costsPath),
            COSTS_FORMAT
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
        const previous = this.resolve(task);
        const measuredRssGb = inflate(attempt.peakRssGb);
        const peakRssGb =
            attempt.code === 0
                ? measuredRssGb
                : Math.max(measuredRssGb ?? 0, previous.rssGb);
        const measuredCores = inflate(attempt.avgCores);
        // A failed or stalled attempt must not make the next admission cheaper.
        const avgCores =
            attempt.code === 0
                ? measuredCores
                : Math.max(measuredCores ?? 0, previous.cores);
        if (pending.sample) this.addToFileSums(task, pending.sample, -1);
        pending.sample = {
            starved: metadata.starveCount > 0,
            durationMs:
                attempt.code === 0
                    ? attempt.durationMs
                    : Math.max(attempt.durationMs, previous.durationMs),
            peakRssGb,
            avgCores,
            measurementReason:
                attempt.measurementReason ??
                (peakRssGb === null || avgCores === null
                    ? "legacy-measurements-unavailable"
                    : null)
        };
        this.addToFileSums(task, pending.sample, 1);
        pending.starved = metadata.starveCount > 0;
        pending.succeeded =
            attempt.code === 0 &&
            !pending.starved &&
            SAMPLE_FIELDS.every((field) => numeric(attempt[field]));
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

    // Each value falls back on its own: a measurement without cores or memory
    // (an older worker) still lets the committed cost or a sibling supply them.
    resolve(task) {
        const key = this.key(task);
        const layers = [this.pending.get(key)?.sample, this.costs[key]];
        const measured = (field) =>
            layers.map((layer) => layer?.[field]).find(numeric);
        const sibling = this.siblingMean(task);
        const fallback = defaultCost();
        const override = this.overrides[key] ?? {};
        const value = (overridden, field) =>
            overridden ?? measured(field) ?? sibling?.[field];
        const cores = value(override.cores, "avgCores");
        const rssGb = value(override.rssGb, "peakRssGb");
        return {
            durationMs:
                value(override.durationMs, "durationMs") ?? fallback.durationMs,
            cores: cores ?? fallback.cores,
            rssGb: rssGb ?? fallback.rssGb,
            // Measured or overridden cores and memory, not a default or a
            // sibling's estimate.
            known:
                (override.cores ?? measured("avgCores")) !== undefined &&
                (override.rssGb ?? measured("peakRssGb")) !== undefined
        };
    }

    // Persisting is best effort: a cache that cannot be written warns
    // and keeps this run's measurements pending, and never fails the run.
    commit({ interrupted = false, pruneDeleted = false } = {}) {
        if (
            interrupted ||
            this.readOnly ||
            (!this.pending.size && !pruneDeleted)
        )
            return;
        const isDeleted = pruneDeleted
            ? deletedCostChecker(this.projectRoot)
            : () => false;
        // Replace atomically with this run only; never inherit older measurements.
        const tasks = {};
        for (const [key, { sample, at }] of this.pending) {
            // Missing measurements stay missing in this run's cache.
            const entry = Object.fromEntries(
                SAMPLE_FIELDS.map((field) => [
                    field,
                    numeric(sample[field]) ? sample[field] : null
                ])
            );
            entry.measurementReason = [
                entry.peakRssGb,
                entry.avgCores
            ].includes(null)
                ? (sample.measurementReason ??
                  "legacy-measurements-unavailable")
                : null;
            if (sample.starved) entry.starved = true;
            entry.samples = 1;
            entry.lastSeenAt = at;
            tasks[key] = entry;
        }
        for (const key of Object.keys(tasks)) {
            if (isDeleted(key)) delete tasks[key];
        }
        try {
            writeJsonAtomic(this.cachePath, { version: CACHE_VERSION, tasks });
        } catch (error) {
            console.warn(`Unable to commit cost cache: ${error.message}`);
            return;
        }
        if (!this.commitCosts(isDeleted)) return;
        this.pending.clear();
        this.fileSums.clear();
        this.fileRevisions.clear();
        this.generation++;
    }

    // Preserve established baselines; replace temporary starvation inflation
    // after a successful measured attempt. False keeps measurements pending.
    commitCosts(isDeleted = () => false) {
        let unreadable = null;
        const costs = readCache(
            this.costsPath,
            (error) => (unreadable = error),
            COSTS_FORMAT
        );
        // A committed file is never replaced by one rebuilt from nothing.
        if (unreadable) {
            console.warn(
                `Not updating test costs ${this.costsPath}: it could not be read (${unreadable.message})`
            );
            return false;
        }
        let changed = false;
        for (const [key, { sample, starved, succeeded }] of this.pending) {
            if (!costs[key] && !succeeded && !starved) continue;
            if (costs[key] && !starved && !(costs[key].starved && succeeded))
                continue;
            const next = committedCost(sample, costs[key]);
            costs[key] = next;
            changed = true;
        }
        for (const key of Object.keys(costs)) {
            if (isDeleted(key)) {
                delete costs[key];
                changed = true;
            }
        }
        if (changed) {
            try {
                writeCosts(this.costsPath, costs);
            } catch (error) {
                console.warn(`Unable to update test costs: ${error.message}`);
                return false;
            }
        }
        this.costs = costs;
        return true;
    }
}

/**
 * Copy every test's latest measurement from the cache into the committed
 * costs, whatever it drifted by. Tests the cache lacks keep their committed
 * cost. Returns the number of tasks written.
 */
function refreshCosts({
    projectRoot = process.cwd(),
    cachePath = DEFAULT_COST_CACHE_PATH,
    costsPath = DEFAULT_COSTS_PATH
} = {}) {
    const root = path.resolve(projectRoot);
    // Anything unreadable stops the refresh: a broken costs file must not be
    // rewritten as if it were empty.
    const strict = (file, format) =>
        readCache(
            file,
            (error) => {
                throw new Error(
                    `Cannot refresh from ${file}: ${error.message}`
                );
            },
            format
        );
    const target = path.resolve(root, costsPath);
    const cacheFile = path.resolve(root, cachePath);
    // The costs file may not exist yet; the cache it is refreshed from must.
    if (!fs.existsSync(cacheFile))
        throw new Error(`Cannot refresh from ${cacheFile}: no such file`);
    const costs = strict(target, COSTS_FORMAT);
    for (const [key, entry] of Object.entries(strict(cacheFile))) {
        costs[key] = committedCost(entry, costs[key]);
    }
    writeCosts(target, costs);
    return Object.keys(costs).length;
}

module.exports = { CostCache, defaultCost, readOverrides, refreshCosts };
