// @spec-test-coverage-ignore: fixture support for the light client benchmark of channel flows (scripts/bench/lightClientFlows.ts).
/**
 * The light client benchmark of channel flows runs existing tests with
 * `BENCH_FLOWS_FILE` set. Every peer then reaches the test node through a
 * proxy of its own, so what its runtime asks the node is counted apart from
 * the harness's own requests; with `BENCH_FLOWS_COMPARE=1` its light client
 * asks the node every read it answers at the same block
 * (`LIGHT_CLIENT_COMPARE_READS`). At cleanup the harness writes, per peer, the
 * requests by method, how its light client answered and the trace of its
 * proofs and pushes, to that file.
 */
import type { RecordedMessage, RpcNodeProxy } from "../node/RpcNodeProxy";
import type { LightClientStorageBlock } from "@/evm/p2pRuntime/rpcNodes/lightClient/lightClientWire";
import SubstrateHeader from "@/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/SubstrateHeader";
import type { Config } from "@/utils/config";
import type { LightClientCounts } from "@test/fixtures/customRpc/harnessControl/services/lightClient/LightClientControlService";
import { writeFileSync } from "node:fs";

/** Peers the harness can start: every one gets a proxy. */
const MAX_PEERS = 10;

/**
 * The state channel manager's address slots, from `stateMachineImplementation`
 * to `utilityFacetAddress` (StateChannelManagerStorage).
 */
export const FLOW_BENCH_FIRST_ADDRESS_SLOT = 6;
export const FLOW_BENCH_LAST_ADDRESS_SLOT = 15;

/** A proof the peer's light client asked the node for. */
type ProofRequest = {
    sequence: number;
    at: number;
    /** The block hash it was asked at; null for the node's best block. */
    block: string | null;
    /** The state trie keys, lowercase. */
    keys: string[];
};

/** A request with no params the trace needs: its place in the order only. */
type PlacedRequest = { sequence: number; at: number };

type Subscribe = PlacedRequest & { address: string; topics: string[] };

type Unsubscribe = PlacedRequest & { subscription: string };

/** A `lightClient_storage` notification the proxy sent on to the peer. */
type Push = PlacedRequest & {
    subscription: string;
    /** True when the node ended the subscription with an error instead. */
    isError: boolean;
    sync: boolean;
    number: number;
    /** Blake2-256 of the SCALE-encoded Substrate header, as the light client computes it. */
    hash: string;
    /** The partition keys it carries, lowercase. */
    keys: string[];
};

/** A request the trace has no list of its own for, with its params and the node's reply. */
type OtherRequest = PlacedRequest & {
    method: string;
    params: unknown;
    reply: RecordedMessage["reply"];
};

/** The methods the trace keeps in lists of their own. */
const TRACED_METHODS: ReadonlySet<string> = new Set([
    "state_getReadProof",
    "chain_getHeader",
    "lightClient_subscribeStorage",
    "lightClient_unsubscribeStorage"
]);

/**
 * In order of `sequence`, everything a peer's light client asked for and was
 * pushed, and every other request the peer's runtime sent.
 */
export type FlowBenchTrace = {
    proofs: ProofRequest[];
    headers: PlacedRequest[];
    subscribes: Subscribe[];
    unsubscribes: Unsubscribe[];
    pushes: Push[];
    others: OtherRequest[];
};

/** One peer's part of a flow benchmark. */
export type FlowBenchPeer = {
    peer: number;
    /** The peer's signer address, lowercase. */
    address: string;
    /** Requests the peer's runtime sent the node, by JSON-RPC method. */
    requests: Record<string, number>;
    requestBytes: number;
    replyBytes: number;
    /** Null when the runtime was gone or its provider is not the light client's. */
    counts: LightClientCounts | null;
    /**
     * Keys the peer's proofs asked for, by what they hold and whose
     * (`storage:<address>`, `code:<address>`, `account:<address>`, or
     * `other`), with repeats.
     */
    provenKeys: Record<string, number>;
    trace: FlowBenchTrace;
    /**
     * Every 32-byte word in the params of the peer's other requests and of
     * the Ethereum notifications it was sent, lowercase: the candidate keys
     * a storage slot's mapping keys are looked for among.
     */
    words: string[];
};

/** What the chain held for the addresses the proofs name, read while the node still ran. */
export type FlowBenchLabels = {
    /** The state channel manager, lowercase. */
    stateChannelManager: string;
    /** The manager's address slots (state machine and facets), by slot number: the address each holds, lowercase. */
    managerAddressSlots: Record<number, string>;
    /** Every address a proof names, lowercase: whether it held code at the end of the flow. */
    hasCode: Record<string, boolean>;
};

/** `twox128` prefixes of the state maps a Frontier key lives in, and what each holds. */
const KEY_PREFIXES: readonly [prefix: string, kind: string][] = [
    [
        "0x1da53b775b270400e7e61ed5cbc5a146ab1160471b1418779239ba8e2b847e42",
        "storage"
    ],
    [
        "0x1da53b775b270400e7e61ed5cbc5a146ea70f53d5a3306ce02aaf97049cf181a",
        "code"
    ],
    [
        "0x26aa394eea5630e07c48ae0c9558cef7b99d880ec681799c0cf30e8886371da9",
        "account"
    ]
];

/**
 * What a state trie key holds and whose: the map's 32-byte prefix, then
 * `Blake2_128Concat` of the address, whose last 20 bytes are the address.
 */
function keyKind(key: string): string {
    const lower = key.toLowerCase();
    for (const [prefix, kind] of KEY_PREFIXES)
        if (lower.startsWith(prefix)) {
            const addressStart = prefix.length + 2 * 16;
            return `${kind}:0x${lower.slice(addressStart, addressStart + 40)}`;
        }
    return "other";
}

/** The addresses the proofs name. */
export function provenAddresses(peers: FlowBenchPeer[]): string[] {
    const addresses = new Set<string>();
    for (const { trace } of peers)
        for (const { keys } of trace.proofs)
            for (const key of keys) {
                const kind = keyKind(key);
                if (kind !== "other") addresses.add(kind.split(":")[1]);
            }
    return [...addresses];
}

/** The file a flow benchmark writes to, when one runs. */
export function flowBenchFile(): string | undefined {
    return process.env.BENCH_FLOWS_FILE || undefined;
}

/** `byPeer`, with one proxy for every peer it leaves out while a flow benchmark runs. */
export function flowBenchProxies(
    byPeer: Record<number, number> | undefined
): Record<number, number> | undefined {
    if (!flowBenchFile()) return byPeer;
    const all: Record<number, number> = {};
    for (let peer = 0; peer < MAX_PEERS; peer++) all[peer] = 1;
    return { ...all, ...byPeer };
}

/** `overrides`, with the reads compared while a flow benchmark asks for it. */
export function flowBenchConfig(overrides: Partial<Config>): Partial<Config> {
    return flowBenchFile() && process.env.BENCH_FLOWS_COMPARE === "1"
        ? { ...overrides, LIGHT_CLIENT_COMPARE_READS: true }
        : overrides;
}

/**
 * Adds to `words` every 32-byte word of the hex strings in `value`: a string
 * of one word, the words after a 4-byte selector, or a string of whole words.
 */
function collectWords(value: unknown, words: Set<string>): void {
    if (typeof value === "string") {
        if (!/^0x[0-9a-fA-F]+$/.test(value)) return;
        const hex = value.toLowerCase().slice(2);
        const start =
            hex.length % 64 === 0 ? 0 : (hex.length - 8) % 64 === 0 ? 8 : -1;
        if (start < 0) return;
        for (let offset = start; offset < hex.length; offset += 64)
            words.add(`0x${hex.slice(offset, offset + 64)}`);
    } else if (Array.isArray(value))
        for (const item of value) collectWords(item, words);
    else if (typeof value === "object" && value !== null)
        for (const item of Object.values(value)) collectWords(item, words);
}

function lowerAll(values: string[]): string[] {
    return values.map((value) => value.toLowerCase());
}

/** A push as the trace keeps it; the proof nodes are left out. */
function tracePush({ params, sequence, at }: RecordedMessage): Push {
    const { subscription, result, error } = params as {
        subscription: string;
        result?: LightClientStorageBlock;
        error?: unknown;
    };
    if (error !== undefined || !result)
        return {
            sequence,
            at,
            subscription,
            isError: true,
            sync: false,
            number: -1,
            hash: "",
            keys: []
        };
    const header = new SubstrateHeader(result.header);
    return {
        sequence,
        at,
        subscription,
        isError: false,
        sync: result.sync,
        number: header.number,
        hash: header.hash.toLowerCase(),
        keys: lowerAll(result.values.map(({ key }) => key))
    };
}

/** What `proxies` forwarded for one peer, with its runtime's `counts`. */
export function flowBenchPeer(
    peer: number,
    address: string,
    proxies: readonly RpcNodeProxy[],
    counts: LightClientCounts | null
): FlowBenchPeer {
    const requests: Record<string, number> = {};
    const provenKeys: Record<string, number> = {};
    const trace: FlowBenchTrace = {
        proofs: [],
        headers: [],
        subscribes: [],
        unsubscribes: [],
        pushes: [],
        others: []
    };
    const words = new Set<string>();
    for (const proxy of proxies) {
        for (const {
            method,
            params,
            sequence,
            at,
            reply
        } of proxy.forwardedRequests) {
            requests[method] = (requests[method] ?? 0) + 1;
            if (!TRACED_METHODS.has(method))
                trace.others.push({ sequence, at, method, params, reply });
            if (method !== "state_getReadProof") collectWords(params, words);
            if (method === "state_getReadProof") {
                const [keys, block] = params as [string[], string | undefined];
                for (const key of keys) {
                    const kind = keyKind(key);
                    provenKeys[kind] = (provenKeys[kind] ?? 0) + 1;
                }
                trace.proofs.push({
                    sequence,
                    at,
                    block: block?.toLowerCase() ?? null,
                    keys: lowerAll(keys)
                });
            } else if (method === "chain_getHeader")
                trace.headers.push({ sequence, at });
            else if (method === "lightClient_subscribeStorage") {
                const [{ address: contract, topics }] = params as [
                    { address: string; topics: string[] }
                ];
                trace.subscribes.push({
                    sequence,
                    at,
                    address: contract.toLowerCase(),
                    topics: lowerAll(topics)
                });
            } else if (method === "lightClient_unsubscribeStorage")
                trace.unsubscribes.push({
                    sequence,
                    at,
                    subscription: String((params as [string])[0])
                });
        }
        for (const notification of proxy.sentNotifications)
            if (notification.method === "lightClient_storage")
                trace.pushes.push(tracePush(notification));
            else collectWords(notification.params, words);
    }
    for (const list of Object.values(trace))
        (list as PlacedRequest[]).sort((a, b) => a.sequence - b.sequence);
    return {
        peer,
        address: address.toLowerCase(),
        requests,
        requestBytes: proxies.reduce((n, proxy) => n + proxy.requestBytes, 0),
        replyBytes: proxies.reduce((n, proxy) => n + proxy.replyBytes, 0),
        counts,
        provenKeys,
        trace,
        words: [...words].sort()
    };
}

export function writeFlowBench(
    file: string,
    peers: FlowBenchPeer[],
    labels: FlowBenchLabels | null
): void {
    writeFileSync(file, JSON.stringify({ labels, peers }, null, 2));
}
