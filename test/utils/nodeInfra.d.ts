// @spec-test-coverage-ignore: typed interface of the shared node infrastructure; executable evidence belongs to the calling runner and session tests
// Typed interface for ./nodeInfra.js so TypeScript consumers (e.g. the test
// harness) import cleanly without `require`-casting the .js implementation.
import type { ChildProcess } from "node:child_process";

export interface NodeHandle {
    proc: ChildProcess;
    url: string;
    stop: () => void;
    /** Set by the runner's slot pool for teardown logging. */
    label?: string;
    slotId?: number;
    logPath?: string;
    exited?: Promise<{ code: number | null; signal: string | null }>;
    logClosed?: Promise<void>;
}

export interface DiscoveryHandle {
    child: ChildProcess;
    url: string;
    stop: () => void;
    label?: string;
    slotId?: number;
    logPath?: string;
    exited?: Promise<{ code: number | null; signal: string | null }>;
    logClosed?: Promise<void>;
}

export interface StorageDiffServiceHandle {
    child: ChildProcess;
    /** The `ws://` URL the service listens on. */
    url: string;
    stop: () => void;
    label?: string;
    slotId?: number;
    logPath?: string;
    exited?: Promise<{ code: number | null; signal: string | null }>;
    logClosed?: Promise<void>;
}

export interface StartInfraOptions {
    port?: number;
    logPath?: string;
    label?: string;
    env?: Record<string, string | undefined>;
}

export interface StartNodeOptions extends StartInfraOptions {
    /** Copy the chain's output after ready to this process's own. */
    forwardOutput?: boolean;
}

export interface Slot {
    id: number;
    nodeUrl: string;
    discoveryUrl: string;
    storageDiffUrl: string;
    cacheDir: string;
}

export interface Infra {
    nodes: NodeHandle[];
    discoveries: DiscoveryHandle[];
    services: StorageDiffServiceHandle[];
}

export interface GasPeak {
    pct: number;
    used: number;
    limit: number;
    block: number;
}

export function getFreePort(): Promise<number>;

export interface DhtBootstrapper {
    address(): { host: string; port: number };
    destroy(options: { force: boolean }): Promise<void>;
}

export function startDhtBootstrapper(
    host: string,
    options?: { port?: number; attempts?: number }
): Promise<DhtBootstrapper>;
export function startHardhatNode(opts?: StartNodeOptions): Promise<NodeHandle>;
export function testChain(
    env?: Record<string, string | undefined>
): "anvil" | "project";
export function waitForHardhatNode(
    url: string,
    timeoutMs?: number,
    cancelled?: () => boolean
): Promise<void>;
export function startStorageDiffService(options: {
    /** `ws://` URL of the chain node the service follows. */
    upstreamUrl: string;
    logPath?: string;
    label?: string;
    retention?: number;
}): Promise<StorageDiffServiceHandle>;
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
    logDir: string,
    env?: Record<string, string | undefined>
): Promise<{ slots: Slot[]; infra: Infra }>;
export function startGasMonitor(
    slots: Slot[],
    onNewPeak: (slotId: number, peak: GasPeak) => void,
    intervalMs?: number
): { stop: () => void; gasPeak: Map<number, GasPeak> };
