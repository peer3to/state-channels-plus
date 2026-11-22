/**
 * Worker thread of the capacity benchmark (lightClientCapacity.ts): hosts
 * simulated peers. Each peer has a socket of its own to the node, subscribes
 * to one channel's partition, and takes every pushed message through the
 * SDK's own verification and apply (`FrontierPushedPartition.accept`). A peer
 * with a fallback read also proves one key outside its partition at each
 * block it accepts.
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
import { JsonRpcSocket } from "@test/fixtures/lightClient/JsonRpcSocket";
import { contractStoragePrefix, contractValueCount } from "./benchUtils";

export type PeerSpec = {
    id: number;
    contract: string;
    channel: string;
    /** A storage key outside the peer's partition it proves at each block, if any. */
    fallbackKey?: string;
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
    /** Share of the worker's time its event loop was busy since the last take. */
    eventLoopUtilization: number;
    /** Peers the worker hosts. */
    peers: number;
    /** Bytes of the worker's heap in use above what it used before its first peer opened. */
    heapAbovePeerlessBytes: number;
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
    } catch {
        report.refused++;
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
    socket.onNotification((method, params) => {
        if (method === LIGHT_CLIENT_METHODS.notification) onPush(peer, params);
    });
    try {
        await withinTime(
            socket.request(LIGHT_CLIENT_METHODS.subscribe, [
                { address: spec.contract, topics: [spec.channel] }
            ]),
            OPEN_TIMEOUT_MS
        );
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
