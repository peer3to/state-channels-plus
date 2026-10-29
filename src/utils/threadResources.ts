/// <reference lib="es2021.weakref" />
import { errorMessage } from "@/utils/errorMessage";

/**
 * What this thread holds that a browser limits per process: live WebAssembly
 * instances and memories, and the root workers it spawned. On a 64-bit browser
 * V8 reserves about 10 GiB of address space for each 32-bit WebAssembly memory
 * (guard regions), from one pool for the whole renderer process; a 32-bit
 * browser has no guard regions, and a grow there must move the memory. No
 * browser API reports these, so this module counts them: it wraps the
 * WebAssembly constructors once per thread, at its first import. The counts are
 * this thread's only, never the process total.
 */
export interface ThreadResources {
    thread: string;
    /** Root workers this thread spawned that are not shut down. */
    workers: number;
    wasmInstances: number;
    wasmMemories: number;
    /** Committed bytes of the live memories, and of the largest one, in MiB. */
    wasmMemoryMiB: number;
    largestWasmMemoryMiB: number;
    /** Every instance and memory this thread created, collected ones included. */
    wasmInstancesCreated: number;
    wasmMemoriesCreated: number;
    /** This thread's JavaScript heap (Chromium only); WebAssembly memories are not in it. */
    jsHeapUsedMiB?: number;
    jsHeapLimitMiB?: number;
}

/**
 * Whether this thread could still create a new WebAssembly memory and grow it
 * by 16 MiB, at its first WebAssembly failure. It does not repeat the grow that
 * failed: a working probe does not rule out an out-of-memory failure.
 */
export interface WasmMemoryProbe {
    canCreate: boolean;
    canGrow16MiB: boolean;
    error?: string;
}

/** The device and browser, as far as the browser tells them; absent fields are not reported. */
export interface RuntimeEnvironment {
    userAgent?: string;
    /** From User-Agent Client Hints (Chromium): CPU architecture and 32/64 bit. */
    architecture?: string;
    bitness?: string;
    model?: string;
    platform?: string;
    platformVersion?: string;
    mobile?: boolean;
    /** Rounded device RAM (Chromium), in GiB. */
    deviceMemoryGiB?: number;
    hardwareConcurrency?: number;
    crossOriginIsolated?: boolean;
}

/** Attached to a WebAssembly failure where it happened, so it survives the worker hop. */
export interface WasmFailureDiagnostics {
    resources: ThreadResources;
    probe: WasmMemoryProbe;
    environment: RuntimeEnvironment;
}

interface ClientHintsNavigator {
    userAgent?: string;
    hardwareConcurrency?: number;
    deviceMemory?: number;
    userAgentData?: {
        mobile?: boolean;
        platform?: string;
        getHighEntropyValues?(
            hints: string[]
        ): Promise<Record<string, unknown>>;
    };
}

const PROBE_GROW_PAGES = 256;
const BYTES_PER_MIB = 1024 * 1024;

const OriginalMemory = globalThis.WebAssembly?.Memory;
const instances = new Set<WeakRef<WebAssembly.Instance>>();
const memories = new Set<WeakRef<WebAssembly.Memory>>();
const trackedMemories = new WeakSet<WebAssembly.Memory>();
let instancesCreated = 0;
let memoriesCreated = 0;
let workers = 0;
let probe: WasmMemoryProbe | undefined;
let environment = readEnvironment();

function trackMemory(memory: WebAssembly.Memory): void {
    if (trackedMemories.has(memory)) return;
    trackedMemories.add(memory);
    memoriesCreated++;
    memories.add(new WeakRef(memory));
}

/** Its own memory; a memory it imports was counted where it was created. */
function trackInstance(instance: WebAssembly.Instance): void {
    instancesCreated++;
    instances.add(new WeakRef(instance));
    for (const value of Object.values(instance.exports))
        if (value instanceof OriginalMemory) trackMemory(value);
}

function installTracking(): void {
    const wasm = globalThis.WebAssembly;
    if (!wasm) return;
    const OriginalInstance = wasm.Instance;
    wasm.Instance = new Proxy(OriginalInstance, {
        construct(target, args, newTarget) {
            const instance = Reflect.construct(target, args, newTarget);
            trackInstance(instance);
            return instance;
        }
    });
    wasm.Memory = new Proxy(OriginalMemory, {
        construct(target, args, newTarget) {
            const memory = Reflect.construct(target, args, newTarget);
            trackMemory(memory);
            return memory;
        }
    });
    const track = (
        result: WebAssembly.Instance | WebAssembly.WebAssemblyInstantiatedSource
    ) =>
        trackInstance(
            result instanceof OriginalInstance ? result : result.instance
        );
    const instantiate = wasm.instantiate;
    wasm.instantiate = (async (
        source: BufferSource | WebAssembly.Module,
        imports?: WebAssembly.Imports
    ) => {
        const result = await instantiate.call(wasm, source, imports);
        track(result);
        return result;
    }) as typeof wasm.instantiate;
    const instantiateStreaming = wasm.instantiateStreaming;
    if (instantiateStreaming)
        wasm.instantiateStreaming = async (source, imports) => {
            const result = await instantiateStreaming.call(
                wasm,
                source,
                imports
            );
            track(result);
            return result;
        };
}

installTracking();

/** Counts a root worker this thread spawned until its first shutdown ends. */
export function trackWorker<T extends { shutdown(): Promise<void> }>(
    worker: T
): T {
    workers++;
    const shutdown = worker.shutdown;
    let isEnded = false;
    worker.shutdown = async () => {
        try {
            await shutdown.call(worker);
        } finally {
            if (!isEnded) {
                isEnded = true;
                workers--;
            }
        }
    };
    return worker;
}

function toMiB(bytes: number): number {
    return Math.round((bytes / BYTES_PER_MIB) * 10) / 10;
}

function liveValues<T extends object>(set: Set<WeakRef<T>>): T[] {
    const live: T[] = [];
    for (const ref of set) {
        const value = ref.deref();
        if (value) live.push(value);
        else set.delete(ref);
    }
    return live;
}

export function getThreadResources(): ThreadResources {
    const sizes = liveValues(memories).map(
        (memory) => memory.buffer.byteLength
    );
    const heap = (
        globalThis.performance as Performance & {
            memory?: { jsHeapSizeLimit: number; usedJSHeapSize: number };
        }
    ).memory;
    return {
        thread: globalThis.threadName ?? "main",
        workers,
        wasmInstances: liveValues(instances).length,
        wasmMemories: sizes.length,
        wasmMemoryMiB: toMiB(sizes.reduce((total, size) => total + size, 0)),
        largestWasmMemoryMiB: toMiB(Math.max(0, ...sizes)),
        wasmInstancesCreated: instancesCreated,
        wasmMemoriesCreated: memoriesCreated,
        jsHeapUsedMiB: heap && toMiB(heap.usedJSHeapSize),
        jsHeapLimitMiB: heap && toMiB(heap.jsHeapSizeLimit)
    };
}

/** The device as known now: the client hints join once the browser answers. */
export function getRuntimeEnvironment(): RuntimeEnvironment {
    return environment;
}

/** Read at this thread's start; a hint the browser refuses is left out. */
function readEnvironment(): RuntimeEnvironment {
    const nav = globalThis.navigator as ClientHintsNavigator | undefined;
    void nav?.userAgentData
        ?.getHighEntropyValues?.([
            "architecture",
            "bitness",
            "model",
            "platformVersion"
        ])
        .then((hints) => {
            const hint = (name: string) =>
                typeof hints[name] === "string"
                    ? (hints[name] as string)
                    : undefined;
            environment = {
                ...environment,
                architecture: hint("architecture"),
                bitness: hint("bitness"),
                model: hint("model"),
                platformVersion: hint("platformVersion")
            };
        })
        .catch(() => {});
    return {
        userAgent: nav?.userAgent,
        platform: nav?.userAgentData?.platform,
        mobile: nav?.userAgentData?.mobile,
        deviceMemoryGiB: nav?.deviceMemory,
        hardwareConcurrency: nav?.hardwareConcurrency,
        crossOriginIsolated: globalThis.crossOriginIsolated
    };
}

/** Each probe holds a new memory until it is collected, so a thread probes once. */
function probeWasmMemory(): WasmMemoryProbe {
    let memory: WebAssembly.Memory;
    try {
        memory = new OriginalMemory({ initial: 1 });
    } catch (error) {
        return {
            canCreate: false,
            canGrow16MiB: false,
            error: errorMessage(error)
        };
    }
    try {
        memory.grow(PROBE_GROW_PAGES);
        return { canCreate: true, canGrow16MiB: true };
    } catch (error) {
        return {
            canCreate: true,
            canGrow16MiB: false,
            error: errorMessage(error)
        };
    }
}

/**
 * A WebAssembly trap (a Rust panic or a failed allocation shows as
 * `unreachable`) or a failure to compile, link, or allocate WebAssembly memory.
 */
function isWasmFailure(error: unknown): boolean {
    const wasm = globalThis.WebAssembly;
    if (!wasm || !(error instanceof Error)) return false;
    if (
        error instanceof wasm.RuntimeError ||
        error instanceof wasm.CompileError ||
        error instanceof wasm.LinkError
    )
        return true;
    return /WebAssembly|Wasm memory/i.test(error.message);
}

/** The diagnostics an error carries from the thread it failed in, if any. */
export function getErrorWasmDiagnostics(
    error: unknown
): WasmFailureDiagnostics | undefined {
    if (typeof error !== "object" || error === null) return undefined;
    return (error as { wasmDiagnostics?: WasmFailureDiagnostics })
        .wasmDiagnostics;
}

/** This thread's resources, memory probe, and device, for a WebAssembly failure only. */
export function getWasmFailureDiagnostics(
    error: unknown
): WasmFailureDiagnostics | undefined {
    if (!isWasmFailure(error)) return undefined;
    probe ??= probeWasmMemory();
    return {
        resources: getThreadResources(),
        probe,
        environment
    };
}
