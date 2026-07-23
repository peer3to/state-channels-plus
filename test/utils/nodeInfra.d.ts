// Typed interface for ./nodeInfra.js so TypeScript consumers (e.g. the test
// harness) import cleanly without `require`-casting the .js implementation.
import type { ChildProcess } from "node:child_process";

export interface NodeHandle {
    proc: ChildProcess;
    url: string;
    stop: () => void;
    /** Set by the runner's slot pool for teardown logging. */
    label?: string;
}

export interface DiscoveryHandle {
    child: ChildProcess;
    url: string;
    stop: () => void;
    label?: string;
}

export interface StartInfraOptions {
    port?: number;
    logPath?: string;
    label?: string;
    env?: Record<string, string | undefined>;
}

export interface Slot {
    id: number;
    nodeUrl: string;
    discoveryUrl: string;
    cacheDir: string;
}

export interface Infra {
    nodes: NodeHandle[];
    discoveries: DiscoveryHandle[];
}

export interface GasPeak {
    pct: number;
    used: number;
    limit: number;
    block: number;
}

export function getFreePort(): Promise<number>;
export function startHardhatNode(opts?: StartInfraOptions): Promise<NodeHandle>;
export function startDiscoveryRegistry(
    opts?: StartInfraOptions
): Promise<DiscoveryHandle>;
export function jsonRpc(
    url: string,
    method: string,
    params?: unknown[]
): Promise<unknown>;
export function resetSlotCacheDir(dir: string): void;

// Runner-only slot orchestration.
export function teardownInfra(infra: Infra): void;
export function provisionSlots(
    slotCount: number,
    logDir: string
): Promise<{ slots: Slot[]; infra: Infra }>;
export function startGasMonitor(
    slots: Slot[],
    onNewPeak: (slotId: number, peak: GasPeak) => void,
    intervalMs?: number
): { stop: () => void; gasPeak: Map<number, GasPeak> };
