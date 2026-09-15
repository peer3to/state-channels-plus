import type { ResourceLimits } from "node:worker_threads";

// V8 heap caps for SDK worker threads. Without them each worker's old-space
// auto-sizes off total system RAM (V8 assumes it owns the machine), so N
// concurrent test processes — each spawning an SDK and a VM worker — can
// collectively exceed physical memory and force an OS-level OOM/restart. A cap
// turns a runaway worker into a clean per-worker crash instead.
//
// SCP_WORKER_MAX_OLD_SPACE_MB overrides the common cap in megabytes.
// A value <= 0 disables the cap (lets V8 auto-size).
const DEFAULT_MAX_OLD_SPACE_MB = 1024;

function parseMb(raw: string | undefined): number | undefined {
    if (raw == null || raw.trim() === "") return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
}

export function resolveWorkerResourceLimits(): ResourceLimits | undefined {
    const maxOld =
        parseMb(process.env.SCP_WORKER_MAX_OLD_SPACE_MB) ??
        DEFAULT_MAX_OLD_SPACE_MB;

    if (maxOld <= 0) return undefined;

    return { maxOldGenerationSizeMb: maxOld };
}
