/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
    COST_EWMA_ALPHA,
    HEAVY_STARVE_RUNS,
    HEAVY_EL_MS,
    HEAVY_CORES,
    HEAVY_RSS_GB,
    COLD_LIGHT_DURATION_MS,
    COLD_MEDIUM_DURATION_MS,
    COLD_HEAVY_DURATION_MS,
    COLD_LIGHT_CORES,
    COLD_MEDIUM_CORES,
    COLD_HEAVY_CORES,
    COLD_LIGHT_RSS_GB,
    COLD_MEDIUM_RSS_GB,
    COLD_HEAVY_RSS_GB,
    DEFAULT_COST_CACHE_PATH,
    DEFAULT_COST_OVERRIDES_PATH
} = require("./constants");
const { normalizeTaskRunner } = require("./taskRunners");

const numeric = (value) => Number.isFinite(value) && value >= 0;
const object = (value) =>
    value !== null && typeof value === "object" && !Array.isArray(value);
const reasons = new Set([
    "process-sampling-unavailable",
    "legacy-measurements-unavailable"
]);

function coldCost(task) {
    const runner = normalizeTaskRunner(task.runner);
    const browserHeavy =
        runner === "browser" || task.requires?.includes("browser");
    if (browserHeavy)
        return {
            durationMs: COLD_HEAVY_DURATION_MS,
            cores: COLD_HEAVY_CORES,
            rssGb: COLD_HEAVY_RSS_GB,
            heavy: true
        };
    if (runner === "hardhat" && task.isE2E)
        return {
            durationMs: COLD_MEDIUM_DURATION_MS,
            cores: COLD_MEDIUM_CORES,
            rssGb: COLD_MEDIUM_RSS_GB,
            heavy: false
        };
    return {
        durationMs: COLD_LIGHT_DURATION_MS,
        cores: COLD_LIGHT_CORES,
        rssGb: COLD_LIGHT_RSS_GB,
        heavy: false
    };
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

function readOverrides(overridesPath) {
    let overrides;
    try {
        overrides = JSON.parse(fs.readFileSync(overridesPath, "utf8"));
    } catch (error) {
        if (error.code === "ENOENT") return {};
        throw new Error(
            `Unable to read cost overrides ${overridesPath}: ${error.message}`
        );
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
    )
        throw new Error(`Invalid cost overrides ${overridesPath}`);
    return overrides;
}

function EWMA(previous, next) {
    if (next === null) return null;
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

function isCostSample(attempt, metadata) {
    const usage = attempt.reduced ?? attempt;
    return (
        executed(attempt, metadata) &&
        metadata.disposition !== "retry-starvation" &&
        metadata.starveCount === 0 &&
        numeric(attempt.durationMs) &&
        numeric(usage.timing?.maxEventLoopDelayMs ?? attempt.peakElMs ?? 0) &&
        Object.hasOwn(usage, "peakRssGb") ===
            Object.hasOwn(usage, "avgCores") &&
        ["peakRssGb", "avgCores"].every(
            (field) =>
                usage[field] === undefined ||
                usage[field] === null ||
                numeric(usage[field])
        ) &&
        (usage.measurementReason == null ||
            reasons.has(usage.measurementReason))
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
    }

    key(task) {
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
        return `${runner}|${relative}|${task.fullTitle ?? task.label}`;
    }

    record(task, attempt, metadata) {
        const key = this.key(task);
        if (
            executed(attempt, metadata) &&
            Number.isInteger(metadata.starveCount) &&
            metadata.starveCount > 0
        ) {
            const pending = this.pending.get(key) || {
                sample: null,
                starvations: [],
                starved: false
            };
            pending.starved = true;
            pending.at = metadata.at ?? new Date().toISOString();
            pending.starvations.push({
                server: metadata.server,
                at: pending.at
            });
            this.pending.set(key, pending);
        }
        if (!isCostSample(attempt, metadata)) return;
        const pending = this.pending.get(key) || {
            sample: null,
            starvations: [],
            starved: false
        };
        const usage = attempt.reduced ?? attempt;
        const peakRssGb = usage.peakRssGb ?? null;
        const avgCores = usage.avgCores ?? null;
        pending.sample = {
            durationMs: attempt.durationMs,
            peakRssGb,
            avgCores,
            peakElMs:
                usage.timing?.maxEventLoopDelayMs ?? attempt.peakElMs ?? 0,
            measurementReason:
                usage.measurementReason ??
                (peakRssGb === null || avgCores === null
                    ? "legacy-measurements-unavailable"
                    : null)
        };
        pending.at = metadata.at ?? new Date().toISOString();
        this.pending.set(key, pending);
    }

    siblingMean(task) {
        const key = this.key(task);
        const prefix = key.slice(0, key.lastIndexOf("|") + 1);
        const samples = [...this.pending]
            .filter(
                ([other, entry]) =>
                    other !== key && other.startsWith(prefix) && entry.sample
            )
            .map(([, entry]) => entry.sample);
        if (!samples.length) return null;
        return Object.fromEntries(
            ["durationMs", "avgCores", "peakRssGb", "peakElMs"].map((field) => {
                const values = samples
                    .map((sample) => sample[field])
                    .filter(numeric);
                return [
                    field,
                    values.length
                        ? values.reduce((sum, value) => sum + value, 0) /
                          values.length
                        : null
                ];
            })
        );
    }

    resolve(task) {
        const key = this.key(task);
        const sibling = this.siblingMean(task);
        const entry =
            this.pending.get(key)?.sample ??
            (Object.hasOwn(this.tasks, key) ? this.tasks[key] : null) ??
            sibling;
        const cold = coldCost(task);
        const starved =
            this.pending.get(key)?.starved ||
            this.tasks[key]?.recentRuns
                .slice(-HEAVY_STARVE_RUNS)
                .some((run) => run.starved);
        const computed = {
            durationMs: entry?.durationMs ?? cold.durationMs,
            cores: entry?.avgCores ?? cold.cores,
            rssGb: entry?.peakRssGb ?? cold.rssGb,
            heavy:
                !!starved ||
                (entry
                    ? entry.peakElMs > HEAVY_EL_MS ||
                      (entry.avgCores ?? cold.cores) > HEAVY_CORES ||
                      (entry.peakRssGb ?? cold.rssGb) > HEAVY_RSS_GB
                    : cold.heavy)
        };
        const override = Object.hasOwn(this.overrides, key)
            ? this.overrides[key]
            : {};
        const resolved = { ...computed, ...override };
        const heavyOverride = override.heavy;
        resolved.heavy = heavyOverride ?? computed.heavy;
        return resolved;
    }

    commit({ interrupted = false } = {}) {
        if (interrupted) return;
        if (!this.pending.size) return;
        if (this.readDenied)
            throw new Error(
                `Cannot commit cost cache after denied read: ${this.readDenied.message}`
            );
        const tasks = { ...this.tasks };
        for (const [key, pending] of this.pending) {
            const old = Object.hasOwn(tasks, key) ? tasks[key] : null;
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
                for (const field of [
                    "durationMs",
                    "peakRssGb",
                    "avgCores",
                    "peakElMs"
                ])
                    entry[field] = EWMA(old?.[field], sample[field]);
                entry.measurementReason = sample.measurementReason;
                entry.samples++;
            }
            entry.lastSeenAt = pending.at;
            entry.starvations = [...entry.starvations, ...pending.starvations];
            entry.recentRuns = [
                ...entry.recentRuns,
                { at: pending.at, starved: pending.starved }
            ].slice(-HEAVY_STARVE_RUNS);
            Object.defineProperty(tasks, key, {
                value: entry,
                enumerable: true,
                configurable: true,
                writable: true
            });
        }
        const temporary = path.join(
            path.dirname(this.cachePath),
            `.test-costs-${crypto.randomUUID()}.tmp`
        );
        try {
            fs.mkdirSync(path.dirname(this.cachePath), { recursive: true });
            fs.writeFileSync(
                temporary,
                `${JSON.stringify({ version: 1, tasks }, null, 2)}\n`,
                { flag: "wx" }
            );
            fs.renameSync(temporary, this.cachePath);
        } catch (error) {
            try {
                fs.rmSync(temporary, { force: true });
            } catch (cleanupError) {
                throw new Error(
                    `Unable to commit cost cache: ${error.message}; temporary cleanup: ${cleanupError.message}`
                );
            }
            throw new Error(`Unable to commit cost cache: ${error.message}`);
        }
        this.tasks = tasks;
        this.pending.clear();
    }
}

module.exports = { CostCache, coldCost };
