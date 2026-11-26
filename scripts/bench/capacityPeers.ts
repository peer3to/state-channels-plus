/**
 * Worker thread of the capacity benchmark (lightClientCapacity.ts): hosts
 * simulated peers. Each peer has a socket of its own to the node, subscribes
 * to one channel's partition, and takes every pushed message through the
 * SDK's own verification and apply (`FrontierPushedPartition.accept`). A peer
 * with a fallback read also proves one key outside its partition at each
 * block it accepts. A peer with `watch` also follows the contract with a
 * subscription of no topics, as a participant follows its manager: once that
 * subscription's first message arrived it watches the contract's
 * `configCount` slots from `configBase`, and with `freshBase` it then watches
 * one never written slot at a block it accepts on its channel (at each block,
 * or with the chance `freshRate`), as a participant proves the empty calldata
 * commitment of each received block. With `prefill` it watches that many of
 * those slots with the config slots, as a peer that has run for a while.
 * With `ahead` it instead watches a window of `keys` never written slots with
 * the config slots, and every `every` blocks moves it `step` slots on and
 * watches it again in one call, as a participant watches the commitments of
 * the coming heights; with `configEvery` it also watches the config slots
 * again every that many blocks, as a participant's read does once the node
 * released them.
 *
 * Messages from the main thread: `{ type: "add", peers }` opens peers,
 * `{ type: "take" }` answers with what was recorded since the last take and
 * clears it, `{ type: "stop" }` closes every socket.
 */
import { performance } from "node:perf_hooks";
import { getHeapStatistics, setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { parentPort, workerData } from "node:worker_threads";
import { LIGHT_CLIENT_METHODS } from "@/evm/p2pRuntime/rpcNodes/lightClient/lightClientWire";
import { PEER3_CHAIN_CONSTANTS } from "@/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/FrontierChainConstants";
import FrontierPushedPartition from "@/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/FrontierPushedPartition";
import { contractStorageKey } from "@/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/frontierStateKeys";
import { JsonRpcSocket } from "@test/fixtures/lightClient/JsonRpcSocket";
import { getAddress, toBeHex } from "ethers";
import { contractStoragePrefix, contractValueCount } from "./benchUtils";

export type PeerSpec = {
    id: number;
    contract: string;
    channel: string;
    /** A storage key outside the peer's partition it proves at each block, if any. */
    fallbackKey?: string;
    /** The contract's slots the peer watches, if any (see the file comment). */
    watch?: {
        configBase: number;
        configCount: number;
        freshBase?: number;
        /** Never written slots from `freshBase` watched with the config slots. */
        prefill?: number;
        /** The chance, per block, of a fresh slot's watch. */
        freshRate?: number;
        /** A window of never written slots from `freshBase`, watched ahead. */
        ahead?: {
            keys: number;
            every: number;
            step: number;
            configEvery?: number;
        };
    };
};

/** One accepted push at one peer; times are Unix milliseconds. */
export type PushSample = {
    peer: number;
    number: number;
    sync: boolean;
    executedAt: number | null;
    builtAt: number;
    sentAt: number;
    receivedAt: number;
    verifiedAt: number;
    bytes: number;
    /** Keys whose value the push carried. */
    values: number;
    /**
     * Of those, slots of the followed contract's storage: the rest are
     * accounts and code, such as the writer's account, whose nonce changes
     * with every transaction it sends.
     */
    contractValues: number;
    newNodes: number;
    /** Milliseconds the peer's thread spent verifying and applying the push, synchronously. */
    acceptMs: number;
};

export type PeerReport = {
    pushes: PushSample[];
    /** Milliseconds from subscribing to the first accepted sync, per peer opened. */
    syncMs: number[];
    /** Blocks skipped between two accepted pushes of one peer. */
    skippedBlocks: number;
    refused: number;
    /** Subscriptions the node ended. */
    ended: number;
    /** Peers whose socket or subscription the node refused, as past its connection limit. */
    unopened: number;
    fallbackReadMs: number[];
    failedFallbackReads: number;
    /** The subscriptions of no topics: their pushes, as `pushes`, and what they refused or skipped. */
    watchPushes: PushSample[];
    watchSkippedBlocks: number;
    watchRefused: number;
    watchEnded: number;
    /** Milliseconds from asking to watch the config slots to the answer, per peer. */
    watchRegistrationMs: number[];
    failedWatchRegistrations: number;
    /** Milliseconds of each per-block watch of a fresh slot. */
    watchMs: number[];
    failedWatches: number;
    /** Keys a watch answered without watching them: the subscription's cap. */
    keysNotWatched: number;
    /** Share of the worker's time its event loop was busy since the last take. */
    eventLoopUtilization: number;
    /** Peers the worker hosts. */
    peers: number;
    /** Bytes of the worker's heap in use above what it used before its first peer opened. */
    heapAbovePeerlessBytes: number;
};

/** One subscription of a peer: its pushed partition and what it accepted. */
type Followed = {
    partition: FrontierPushedPartition;
    lastNumber?: number;
    synced: boolean;
};

type Peer = {
    spec: PeerSpec;
    socket: JsonRpcSocket;
    partition: FrontierPushedPartition;
    /** Hex prefix of every storage key of the followed contract. */
    storagePrefix: string;
    subscribedAt: number;
    lastNumber?: number;
    synced: boolean;
    /** The subscription of no topics, with its id once the node answered. */
    watch?: Followed & {
        id?: string;
        registered: boolean;
        nextFresh: number;
        /** Blocks of its channel accepted since the watches were registered. */
        blocksWatched: number;
    };
};

/** How long a peer may take to open its socket and subscribe before it counts as unopened. */
const OPEN_TIMEOUT_MS = 30_000;
const { nodeUrl } = workerData as { nodeUrl: string };
const peers: Peer[] = [];
let report: PeerReport = emptyReport();
let utilization = performance.eventLoopUtilization();
// heap readings are taken after a full collection; a worker takes no
// --expose-gc in its execArgv, so the flag is set here
setFlagsFromString("--expose-gc");
const collectGarbage = runInNewContext("gc") as () => void;
collectGarbage();
const peerlessHeapBytes = getHeapStatistics().used_heap_size;

function emptyReport(): PeerReport {
    return {
        pushes: [],
        syncMs: [],
        skippedBlocks: 0,
        refused: 0,
        ended: 0,
        unopened: 0,
        fallbackReadMs: [],
        failedFallbackReads: 0,
        watchPushes: [],
        watchSkippedBlocks: 0,
        watchRefused: 0,
        watchEnded: 0,
        watchRegistrationMs: [],
        failedWatchRegistrations: 0,
        watchMs: [],
        failedWatches: 0,
        keysNotWatched: 0,
        eventLoopUtilization: 0,
        peers: 0,
        heapAbovePeerlessBytes: 0
    };
}

async function fallbackRead(peer: Peer, blockHash: string): Promise<void> {
    if (!peer.spec.fallbackKey) return;
    const started = performance.now();
    try {
        await peer.socket.request("state_getReadProof", [
            [peer.spec.fallbackKey],
            blockHash
        ]);
        report.fallbackReadMs.push(performance.now() - started);
    } catch {
        report.failedFallbackReads++;
    }
}

function onPush(peer: Peer, params: unknown): void {
    const receivedAt = Date.now();
    const { result } = params as { result?: unknown; error?: unknown };
    if (result === undefined) {
        report.ended++;
        return;
    }
    try {
        const acceptStarted = performance.now();
        const accepted = peer.partition.accept(result);
        const acceptMs = performance.now() - acceptStarted;
        const verifiedAt = Date.now();
        if (!accepted) return;
        if (!peer.synced && accepted.sync) {
            peer.synced = true;
            report.syncMs.push(verifiedAt - peer.subscribedAt);
        }
        const number = accepted.block.number;
        if (peer.lastNumber !== undefined && number > peer.lastNumber + 1)
            report.skippedBlocks += number - peer.lastNumber - 1;
        peer.lastNumber = number;
        report.pushes.push({
            peer: peer.spec.id,
            number,
            sync: accepted.sync,
            executedAt: accepted.stages.executedAt,
            builtAt: accepted.stages.builtAt,
            sentAt: accepted.stages.sentAt,
            receivedAt,
            verifiedAt,
            bytes: Buffer.byteLength(JSON.stringify(params)),
            values: accepted.values,
            contractValues: contractValueCount(
                (result as { values: { key: string }[] }).values,
                peer.storagePrefix
            ),
            newNodes: accepted.newNodes,
            acceptMs
        });
        void fallbackRead(peer, accepted.block.hash);
        if (!accepted.sync) void watchFresh(peer, accepted.block.hash);
    } catch {
        report.refused++;
    }
}

/** The trie keys of the contract's slots `first` to `first + count - 1`. */
function slotKeys(contract: string, first: number, count: number): string[] {
    const address = getAddress(contract);
    return Array.from({ length: count }, (_, index) =>
        contractStorageKey(address, toBeHex(first + index, 32))
    );
}

/** The config slots' keys, per contract: the same for every peer of a worker. */
const configKeys = new Map<string, string[]>();

/** Asks the node to watch `keys` on the peer's subscription of no topics, at `block` or the best block. */
async function watchKeys(
    peer: Peer,
    keys: string[],
    block: string | null
): Promise<number> {
    const started = performance.now();
    const answer = await peer.socket.request<{ watched: string[] }>(
        LIGHT_CLIENT_METHODS.watch,
        [peer.watch!.id, keys, block]
    );
    report.keysNotWatched += keys.length - answer.watched.length;
    return performance.now() - started;
}

async function registerWatchedKeys(peer: Peer): Promise<void> {
    const { contract, watch } = peer.spec;
    if (!watch) return;
    let keys = configKeys.get(contract);
    if (!keys) {
        keys = slotKeys(contract, watch.configBase, watch.configCount);
        configKeys.set(contract, keys);
    }
    const prefill = watch.ahead?.keys ?? watch.prefill ?? 0;
    if (prefill > 0)
        keys = [...keys, ...slotKeys(contract, watch.freshBase!, prefill)];
    try {
        report.watchRegistrationMs.push(await watchKeys(peer, keys, null));
        // the window starts at the first slot; fresh slots follow the prefill
        peer.watch!.nextFresh = watch.ahead ? 0 : prefill;
        peer.watch!.registered = true;
    } catch {
        report.failedWatchRegistrations++;
    }
}

/** Watches the window ahead again, or one slot never written, at `blockHash`. */
async function watchFresh(peer: Peer, blockHash: string): Promise<void> {
    const ahead = peer.spec.watch?.ahead;
    if (ahead) return await watchAhead(peer, blockHash, ahead);
    const freshBase = peer.spec.watch?.freshBase;
    const freshRate = peer.spec.watch?.freshRate;
    if (freshBase === undefined || freshRate === undefined) return;
    if (!peer.watch?.registered || Math.random() >= freshRate) return;
    const slot = freshBase + peer.watch.nextFresh++;
    try {
        report.watchMs.push(
            await watchKeys(
                peer,
                slotKeys(peer.spec.contract, slot, 1),
                blockHash
            )
        );
    } catch {
        report.failedWatches++;
    }
}

/** Every `every` blocks the window moved `step` slots on, and every `configEvery` the config slots, watched at `blockHash`. */
async function watchAhead(
    peer: Peer,
    blockHash: string,
    ahead: NonNullable<NonNullable<PeerSpec["watch"]>["ahead"]>
): Promise<void> {
    const watch = peer.watch;
    const spec = peer.spec.watch!;
    if (!watch?.registered) return;
    const blocks = ++watch.blocksWatched;
    const calls: string[][] = [];
    if (blocks % ahead.every === 0) {
        watch.nextFresh += ahead.step;
        calls.push(
            slotKeys(
                peer.spec.contract,
                spec.freshBase! + watch.nextFresh,
                ahead.keys
            )
        );
    }
    if (ahead.configEvery && blocks % ahead.configEvery === 0)
        calls.push(configKeys.get(peer.spec.contract)!);
    for (const keys of calls)
        try {
            report.watchMs.push(await watchKeys(peer, keys, blockHash));
        } catch {
            report.failedWatches++;
        }
}

/** A push on the peer's subscription of no topics. */
function onWatchPush(peer: Peer, params: unknown): void {
    const receivedAt = Date.now();
    const watch = peer.watch!;
    const { result } = params as { result?: unknown };
    if (result === undefined) {
        report.watchEnded++;
        return;
    }
    try {
        const acceptStarted = performance.now();
        const accepted = watch.partition.accept(result);
        const acceptMs = performance.now() - acceptStarted;
        const verifiedAt = Date.now();
        if (!accepted) return;
        if (!watch.synced && accepted.sync) {
            watch.synced = true;
            void registerWatchedKeys(peer);
        }
        const number = accepted.block.number;
        if (watch.lastNumber !== undefined && number > watch.lastNumber + 1)
            report.watchSkippedBlocks += number - watch.lastNumber - 1;
        watch.lastNumber = number;
        report.watchPushes.push({
            peer: peer.spec.id,
            number,
            sync: accepted.sync,
            executedAt: accepted.stages.executedAt,
            builtAt: accepted.stages.builtAt,
            sentAt: accepted.stages.sentAt,
            receivedAt,
            verifiedAt,
            bytes: Buffer.byteLength(JSON.stringify(params)),
            values: accepted.values,
            contractValues: contractValueCount(
                (result as { values: { key: string }[] }).values,
                peer.storagePrefix
            ),
            newNodes: accepted.newNodes,
            acceptMs
        });
    } catch {
        report.watchRefused++;
    }
}

/** `promise`, or a rejection once `ms` passed without it settling. */
function withinTime<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
            () => reject(new Error(`no answer within ${ms} ms`)),
            ms
        );
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function openPeer(spec: PeerSpec): Promise<void> {
    const opening = JsonRpcSocket.open(nodeUrl);
    const socket = await withinTime(opening, OPEN_TIMEOUT_MS).catch(
        (error: unknown) => {
            // a socket that opens after the timeout is closed, not left connected
            void opening.then(
                (late) => late.close(),
                () => undefined
            );
            throw error;
        }
    );
    const peer: Peer = {
        spec,
        socket,
        partition: new FrontierPushedPartition(PEER3_CHAIN_CONSTANTS),
        // the storage map's 32-byte prefix and the contract's 36-byte hashed
        // address, ahead of the hashed slot
        storagePrefix: contractStoragePrefix(spec.contract),
        subscribedAt: Date.now(),
        synced: false
    };
    if (spec.watch)
        peer.watch = {
            partition: new FrontierPushedPartition(PEER3_CHAIN_CONSTANTS),
            synced: false,
            registered: false,
            nextFresh: 0,
            blocksWatched: 0
        };
    // pushes that came before their subscription's id did: handled once it is known
    const early: { subscription: string; params: unknown }[] = [];
    let channelId: string | undefined;
    const route = (subscription: string, params: unknown) => {
        if (subscription === channelId) onPush(peer, params);
        else if (subscription === peer.watch?.id) onWatchPush(peer, params);
        else early.push({ subscription, params });
    };
    socket.onNotification((method, params) => {
        if (method === LIGHT_CLIENT_METHODS.notification)
            route((params as { subscription: string }).subscription, params);
    });
    const known = () => {
        for (const { subscription, params } of early.splice(0))
            route(subscription, params);
    };
    try {
        channelId = await withinTime(
            socket.request<string>(LIGHT_CLIENT_METHODS.subscribe, [
                { address: spec.contract, topics: [spec.channel] }
            ]),
            OPEN_TIMEOUT_MS
        );
        known();
        if (peer.watch) {
            peer.watch.id = await withinTime(
                socket.request<string>(LIGHT_CLIENT_METHODS.subscribe, [
                    { address: spec.contract, topics: [] }
                ]),
                OPEN_TIMEOUT_MS
            );
            known();
        }
    } catch (error) {
        socket.close();
        throw error;
    }
    peers.push(peer);
}

parentPort?.on(
    "message",
    async (
        message:
            | { type: "add"; peers: PeerSpec[] }
            | { type: "take" }
            | { type: "stop" }
    ) => {
        if (message.type === "add") {
            const opened = await Promise.allSettled(
                message.peers.map(openPeer)
            );
            report.unopened += opened.filter(
                ({ status }) => status === "rejected"
            ).length;
            parentPort?.postMessage({ type: "added" });
        } else if (message.type === "take") {
            const now = performance.eventLoopUtilization();
            report.eventLoopUtilization = performance.eventLoopUtilization(
                now,
                utilization
            ).utilization;
            utilization = now;
            report.peers = peers.length;
            collectGarbage();
            report.heapAbovePeerlessBytes =
                getHeapStatistics().used_heap_size - peerlessHeapBytes;
            parentPort?.postMessage({ type: "report", report });
            report = emptyReport();
        } else {
            for (const peer of peers) peer.socket.close();
            parentPort?.postMessage({ type: "stopped" });
        }
    }
);
