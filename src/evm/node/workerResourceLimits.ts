import type { ResourceLimits } from "node:worker_threads";

// V8 heap caps for SDK worker threads. Without them each worker's old-space
// auto-sizes off total system RAM (V8 assumes it owns the machine), so N
// concurrent test processes — each spawning an SDK and a VM worker — can
// collectively exceed physical memory and force an OS-level OOM/restart. A cap
// turns a runaway worker into a clean per-worker crash instead.
//
// Override per role via env (megabytes); a role var wins over the shared var:
//   SCP_SDK_WORKER_MAX_OLD_SPACE_MB  - p2p/SDK runtime worker
//   SCP_VM_WORKER_MAX_OLD_SPACE_MB   - contract-executor (EVM) worker
//   SCP_WORKER_MAX_OLD_SPACE_MB      - applied to both when the role var is unset
// A value <= 0 disables the cap for that role (lets V8 auto-size).
const DEFAULT_MAX_OLD_SPACE_MB = 1024;

export type WorkerRole = "sdk" | "vm";

function parseMb(raw: string | undefined): number | undefined {
    if (raw == null || raw.trim() === "") return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
}

export function resolveWorkerResourceLimits(
    role: WorkerRole
): ResourceLimits | undefined {
    const roleVar =
        role === "sdk"
            ? process.env.SCP_SDK_WORKER_MAX_OLD_SPACE_MB
            : process.env.SCP_VM_WORKER_MAX_OLD_SPACE_MB;
    const maxOld =
        parseMb(roleVar) ??
        parseMb(process.env.SCP_WORKER_MAX_OLD_SPACE_MB) ??
        DEFAULT_MAX_OLD_SPACE_MB;

    if (maxOld <= 0) return undefined;

    return { maxOldGenerationSizeMb: maxOld };
}
