/**
 * Breaks down the proofs the light client asked for in the benchmark of
 * channel flows (scripts/bench/lightClientFlows.ts): for every
 * `state_getReadProof` a peer sent, the block it read at against the pushes
 * the peer held then, and for every key what it holds and whether the
 * peer's pushed partition held it. Offline, over a results directory:
 *
 *   yarn ts-node scripts/bench/lightClientFlowBreakdown.ts <results dir>
 *   yarn ts-node scripts/bench/lightClientFlowBreakdown.ts --self-test
 *
 * Each peer's partitions are rebuilt from the pushes its proxy sent on, as
 * FrontierPushedPartition takes them: a sync starts a partition over, a
 * later push adds its keys, the same block again changes nothing, an earlier
 * block or a change before any sync is refused and empties it. A proof
 * request's place among the pushes is the proxy's record order.
 *
 * Storage slots of the state channel manager are named from its storage
 * layout (`forge inspect StateChannelManagerProxy storageLayout`), with
 * mapping keys looked for among the channel ids the peers subscribed to,
 * the addresses seen, the selectors of every compiled contract, small
 * integers and every 32-byte word of the peers' other requests and
 * notifications. A slot none of them reaches stays unresolved.
 *
 * Every other request a peer's runtime sent, with the light client off and
 * on, is grouped by what it asked: the called contract and function, the
 * block tag and the node's reply. A read of a method the light client may
 * answer is put through the SDK's own parser: one it parses, the light
 * client tried and left to the node, and their number must equal its
 * counters' reads left to the nodes, failed and unsupported.
 *
 * Writes breakdown.json and breakdown.md into the results directory.
 */
import {
    LOCAL_READ_METHODS,
    parseLocalRead
} from "../../src/evm/p2pRuntime/rpcNodes/lightClient/LocalReadParser";
import { keccak_256 } from "@noble/hashes/sha3";
import { Interface, type InterfaceAbi } from "ethers";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type {
    FlowBenchLabels,
    FlowBenchPeer
} from "../../test/fixtures/lightClient/flowBench";

/** `twox128` map prefixes of Frontier's state, as frontierStateKeys.ts. */
const STORAGE_PREFIX =
    "0x1da53b775b270400e7e61ed5cbc5a146ab1160471b1418779239ba8e2b847e42";
const CODE_PREFIX =
    "0x1da53b775b270400e7e61ed5cbc5a146ea70f53d5a3306ce02aaf97049cf181a";
const ACCOUNT_PREFIX =
    "0x26aa394eea5630e07c48ae0c9558cef7b99d880ec681799c0cf30e8886371da9";
/** `Ethereum.CurrentBlock`: a read's block environment when no push carries it. */
const ENVIRONMENT_KEY =
    "0x2013754dd003840aea66b349f8241e25c8c156f8164e0465c74b8972ea68b4b3";
/** Hex characters of a prefix, of `Blake2_128` and of an address. */
const PREFIX_HEX = 64;
const BLAKE_HEX = 32;
const ADDRESS_HEX = 40;
const SLOT_HEX = 64;
const ZERO_ADDRESS = `0x${"0".repeat(40)}`;

/** The manager's value slots: config 0-5, state machine and facet addresses 6-15. */
const LAST_CONFIG_SLOT = 5n;
const LAST_ADDRESS_SLOT = 15n;
/** Elements of a dynamic array, and words of a long `bytes`, whose slots are named. */
const ARRAY_ELEMENTS = 1 << 20;
/** Slots the storage-layout search generates at one mapping depth before it stops. */
const MAX_SLOTS_PER_DEPTH = 4_000_000;
/** Largest integer taken from the words as a candidate mapping key. */
const MAX_INTEGER_WORD = 2n ** 48n;
/** Small integers always tried as mapping keys. */
const SMALL_INTEGERS = 1024;

/** A 32-byte hex word, lowercase 0x-prefixed. */
type Word = string;
/** A 20-byte address, lowercase 0x-prefixed. */
type Address = string;
/** A state trie key, lowercase 0x-prefixed. */
type TrieKey = string;
/** A storage slot of the manager as a 32-byte word. */
type SlotWord = Word;

type ParsedKey =
    | { kind: "storage"; address: Address; slot: SlotWord }
    | { kind: "code" | "account"; address: Address }
    | { kind: "environment" }
    | { kind: "other" };

/** What a key is, for the breakdown. Ordered as the report lists them. */
const KEY_CLASSES = [
    "inPartition",
    "environment",
    "managerConfig",
    "managerAddressSlots",
    "managerRoutes",
    "managerFollowedChannel",
    "managerOtherChannelOrKey",
    "managerOpenChannelList",
    "managerUnresolved",
    "managerCodeAccount",
    "facetOrStateMachineCodeAccount",
    "stateMachineStorage",
    "ownAccount",
    "otherPeerAccount",
    "zeroAddressAccount",
    "otherContract",
    "otherAccount",
    "otherKey"
] as const;
type KeyClass = (typeof KEY_CLASSES)[number];

const KEY_CLASS_NAMES: Record<KeyClass, string> = {
    inPartition: "held by the peer's partition at the read block (unexpected)",
    environment: "block environment (Ethereum.CurrentBlock)",
    managerConfig: "manager config, slots 0-5",
    managerAddressSlots: "manager state machine + facet addresses, slots 6-15",
    managerRoutes: "manager selectorRoutes entries",
    managerFollowedChannel: "manager mappings of a channel the peer follows",
    managerOtherChannelOrKey:
        "manager mappings of another channel or another first key",
    managerOpenChannelList: "manager openChannelIds",
    managerUnresolved: "manager slot not resolved",
    managerCodeAccount: "manager code + account",
    facetOrStateMachineCodeAccount: "facet / state machine code + account",
    stateMachineStorage: "state machine storage",
    ownAccount: "the peer's own account",
    otherPeerAccount: "another peer's account",
    zeroAddressAccount: "zero-address account (call without from)",
    otherContract: "other contract (storage, code, account)",
    otherAccount: "other account without code",
    otherKey: "other trie key"
};

/**
 * Cumulative push hypotheses: requests at a pushed block that would remain
 * if the partition also held the keys of these classes. Exact for the same
 * reads at the same blocks.
 */
const HYPOTHESES: readonly { name: string; adds: KeyClass[] }[] = [
    { name: "as measured", adds: [] },
    {
        name: "+ manager config, address slots, routes",
        adds: ["managerConfig", "managerAddressSlots", "managerRoutes"]
    },
    {
        name: "+ own account, zero-address account",
        adds: ["ownAccount", "zeroAddressAccount"]
    },
    {
        name: "+ manager, facet, state machine code + account",
        adds: ["managerCodeAccount", "facetOrStateMachineCodeAccount"]
    },
    {
        name: "+ every other manager slot",
        adds: [
            "managerFollowedChannel",
            "managerOtherChannelOrKey",
            "managerOpenChannelList",
            "managerUnresolved"
        ]
    },
    { name: "+ every key", adds: [...KEY_CLASSES] }
];

/** Where a proof request's block stands against the pushes the peer held when it was sent. */
const CONTEXTS = [
    "atPushedBlock",
    "beforeFirstPush",
    "atSupersededPushedBlock",
    "atUnpushedBlockPushedLater",
    "atUnpushedBlockNeverPushed",
    "atBestBlock"
] as const;
type Context = (typeof CONTEXTS)[number];

const CONTEXT_NAMES: Record<Context, string> = {
    atPushedBlock: "at the newest block the peer held a push of",
    beforeFirstPush: "before the peer held any push",
    atSupersededPushedBlock:
        "at a pushed block the partition had already moved past",
    atUnpushedBlockPushedLater: "at a block whose push came after the request",
    atUnpushedBlockNeverPushed: "at a block never pushed to the peer",
    atBestBlock: "at the node's best block (no hash)"
};

type LayoutVariable = { label: string; slot: string; type: string };
type LayoutType = {
    encoding: "inplace" | "mapping" | "dynamic_array" | "bytes";
    label: string;
    numberOfBytes: string;
    key?: string;
    value?: string;
    base?: string;
    members?: LayoutVariable[];
};
type Layout = { storage: LayoutVariable[]; types: Record<string, LayoutType> };

/** What a manager slot is: its variable, its path and the first mapping key, if any. */
type SlotName = { variable: string; path: string; firstKey?: Word };

type FlowFile = { labels: FlowBenchLabels | null; peers: FlowBenchPeer[] };

function parseKey(key: TrieKey): ParsedKey {
    if (key === ENVIRONMENT_KEY) return { kind: "environment" };
    const addressAt = 2 + PREFIX_HEX + BLAKE_HEX;
    const address = `0x${key.slice(addressAt, addressAt + ADDRESS_HEX)}`;
    if (key.startsWith(STORAGE_PREFIX)) {
        const slotAt = addressAt + ADDRESS_HEX + BLAKE_HEX;
        if (key.length !== slotAt + SLOT_HEX) return { kind: "other" };
        return { kind: "storage", address, slot: `0x${key.slice(slotAt)}` };
    }
    for (const [prefix, kind] of [
        [CODE_PREFIX, "code"],
        [ACCOUNT_PREFIX, "account"]
    ] as const)
        if (key.startsWith(prefix))
            return key.length === addressAt + ADDRESS_HEX
                ? { kind, address }
                : { kind: "other" };
    return { kind: "other" };
}

function toWord(value: bigint): Uint8Array {
    const bytes = new Uint8Array(32);
    let rest = value;
    for (let i = 31; i >= 0; i--) {
        bytes[i] = Number(rest & 0xffn);
        rest >>= 8n;
    }
    return bytes;
}

function bytesToBigInt(bytes: Uint8Array): bigint {
    let value = 0n;
    for (const byte of bytes) value = (value << 8n) | BigInt(byte);
    return value;
}

function wordHex(value: bigint): SlotWord {
    return `0x${value.toString(16).padStart(64, "0")}`;
}

/** `keccak256(key ++ slot)`, the slot of a mapping entry. */
function mappingSlot(key: Uint8Array, base: bigint): bigint {
    const input = new Uint8Array(64);
    input.set(key, 0);
    input.set(toWord(base), 32);
    return bytesToBigInt(keccak_256(input));
}

function dataSlot(base: bigint): bigint {
    return bytesToBigInt(keccak_256(toWord(base)));
}

/** A candidate mapping key, ABI-encoded to 32 bytes, and how the report names it. */
type Candidate = { encoded: Uint8Array; name: string; word: Word };

function hexBytes(hex: string): Uint8Array {
    const clean = hex.slice(2);
    const bytes = new Uint8Array(clean.length / 2);
    for (let i = 0; i < bytes.length; i++)
        bytes[i] = parseInt(clean.slice(2 * i, 2 * i + 2), 16);
    return bytes;
}

function leftPadded(hex: string): Candidate {
    const word = `0x${hex.slice(2).padStart(64, "0")}`;
    return { encoded: hexBytes(word), name: hex, word };
}

function rightPadded(hex: string, name: string): Candidate {
    const word = `0x${hex.slice(2).padEnd(64, "0")}`;
    return { encoded: hexBytes(word), name, word };
}

/** Every function selector of the compiled contracts, with the function names. */
function loadSelectors(root: string): Map<string, string> {
    const names = new Map<string, Set<string>>();
    const visit = (dir: string) => {
        for (const entry of readdirSync(dir)) {
            const full = path.join(dir, entry);
            if (statSync(full).isDirectory()) visit(full);
            else if (entry.endsWith(".json") && !entry.endsWith(".dbg.json")) {
                const artifact = JSON.parse(readFileSync(full, "utf8")) as {
                    abi?: InterfaceAbi;
                };
                if (!artifact.abi) continue;
                new Interface(artifact.abi).forEachFunction((fragment) => {
                    const set = names.get(fragment.selector) ?? new Set();
                    set.add(fragment.name);
                    names.set(fragment.selector, set);
                });
            }
        }
    };
    visit(root);
    return new Map(
        [...names].map(([selector, set]) => [selector, [...set].join("|")])
    );
}

/** The candidate keys of each mapping key type. */
type Pools = {
    channelIds: Candidate[];
    bytes32: Candidate[];
    addresses: Candidate[];
    selectors: Candidate[];
    integers: Candidate[];
};

function buildPools(
    file: FlowFile,
    selectors: Map<string, string>,
    keyAddresses: Set<Address>
): Pools {
    const channelIds = new Set<Word>();
    const words = new Set<Word>();
    const addresses = new Set<Address>(keyAddresses);
    for (const peer of file.peers) {
        addresses.add(peer.address);
        for (const subscribe of peer.trace.subscribes)
            for (const topic of subscribe.topics) channelIds.add(topic);
        for (const word of peer.words) words.add(word);
    }
    if (file.labels) {
        addresses.add(file.labels.stateChannelManager);
        for (const address of Object.values(file.labels.managerAddressSlots))
            addresses.add(address);
    }
    const integers = new Set<bigint>();
    for (let i = 0; i < SMALL_INTEGERS; i++) integers.add(BigInt(i));
    for (const word of words) {
        const value = BigInt(word);
        if (value < MAX_INTEGER_WORD) integers.add(value);
        // an address ABI-encoded in a word
        if (value > 0n && value < 2n ** 160n)
            addresses.add(`0x${word.slice(26)}`);
    }
    for (const id of channelIds) words.add(id);
    const asKey = (word: Word): Candidate => ({
        ...leftPadded(word),
        name: channelIds.has(word) ? "<channel>" : word
    });
    return {
        channelIds: [...channelIds].map(asKey),
        bytes32: [...words].map(asKey),
        addresses: [...addresses].map((address) => leftPadded(address)),
        selectors: [...selectors].map(([selector, name]) =>
            rightPadded(selector, name)
        ),
        integers: [...integers].map((value) => ({
            encoded: toWord(value),
            name: value.toString(),
            word: wordHex(value)
        }))
    };
}

function keyPool(typeLabel: string, pools: Pools): Candidate[] | undefined {
    if (typeLabel === "bytes32") return pools.bytes32;
    if (typeLabel === "address" || typeLabel.startsWith("contract "))
        return pools.addresses;
    if (typeLabel === "bytes4") return pools.selectors;
    if (/^u?int\d*$/.test(typeLabel)) return pools.integers;
    if (typeLabel === "bool") return pools.integers.slice(0, 2);
    return undefined;
}

/** A place in the storage layout still to name. */
type Frame = {
    type: string;
    base: bigint;
    path: string;
    variable: string;
    firstKey?: Word;
};

/** The first target at or above `from` in ascending `sorted`, if below `to`. */
function targetIn(
    sorted: bigint[],
    from: bigint,
    to: bigint
): bigint | undefined {
    let low = 0;
    let high = sorted.length;
    while (low < high) {
        const middle = (low + high) >> 1;
        if (sorted[middle] < from) low = middle + 1;
        else high = middle;
    }
    return low < sorted.length && sorted[low] < to ? sorted[low] : undefined;
}

/**
 * Names the manager's slots in `targets`: walks the storage layout mapping
 * depth by mapping depth, until every target is named. A mapping whose keys
 * would take a depth past {@link MAX_SLOTS_PER_DEPTH} slots is not expanded.
 * An array's or a long `bytes`' data is not walked element by element: the
 * targets inside its range are looked up, and only their elements walked.
 * `firstKeys` are the keys tried at the outermost mapping level.
 */
function resolveSlots(
    layout: Layout,
    pools: Pools,
    firstKeys: Candidate[],
    targets: Set<SlotWord>
): { names: Map<SlotWord, SlotName>; truncatedAtDepth: number | null } {
    const names = new Map<SlotWord, SlotName>();
    const targetValues = new Set([...targets].map((target) => BigInt(target)));
    const sortedTargets = [...targetValues].sort((a, b) =>
        a < b ? -1 : a > b ? 1 : 0
    );
    let truncatedAtDepth: number | null = null;
    const name = (slot: bigint, frame: Frame, suffix = "") => {
        if (!targetValues.has(slot)) return;
        const word = wordHex(slot);
        if (!names.has(word))
            names.set(word, {
                variable: frame.variable,
                path: frame.path + suffix,
                firstKey: frame.firstKey
            });
    };
    const slotsOf = (type: string) =>
        BigInt(
            Math.max(
                1,
                Math.ceil(Number(layout.types[type].numberOfBytes) / 32)
            )
        );
    let frames: Frame[] = layout.storage.map((variable) => ({
        type: variable.type,
        base: BigInt(variable.slot),
        path: variable.label,
        variable: variable.label
    }));
    for (let depth = 0; frames.length > 0; depth++) {
        if (names.size === targets.size) break;
        const next: Frame[] = [];
        let generated = 0;
        const stack = [...frames];
        while (stack.length > 0) {
            const frame = stack.pop()!;
            const type = layout.types[frame.type];
            if (type.encoding === "inplace") {
                if (type.members) {
                    // reversed, so a slot members share is named after the first
                    for (const member of [...type.members].reverse())
                        stack.push({
                            ...frame,
                            type: member.type,
                            base: frame.base + BigInt(member.slot),
                            path: `${frame.path}.${member.label}`
                        });
                    continue;
                }
                const slots = slotsOf(frame.type);
                if (type.base && layout.types[type.base].members) {
                    const stride = slotsOf(type.base);
                    for (let i = 0n; i * stride < slots; i++)
                        stack.push({
                            ...frame,
                            type: type.base,
                            base: frame.base + i * stride,
                            path: `${frame.path}[${i}]`
                        });
                } else
                    for (let i = 0n; i < slots; i++)
                        name(frame.base + i, frame, slots > 1n ? `+${i}` : "");
            } else if (type.encoding === "mapping") {
                const keyLabel = layout.types[type.key!].label;
                const usable =
                    frame.firstKey === undefined && keyLabel === "bytes32"
                        ? firstKeys
                        : keyPool(keyLabel, pools);
                if (!usable) continue;
                if (generated + usable.length > MAX_SLOTS_PER_DEPTH) {
                    truncatedAtDepth ??= depth + 1;
                    continue;
                }
                generated += usable.length;
                for (const key of usable)
                    next.push({
                        type: type.value!,
                        base: mappingSlot(key.encoded, frame.base),
                        path: `${frame.path}[${key.name}]`,
                        variable: frame.variable,
                        firstKey: frame.firstKey ?? key.word
                    });
            } else if (type.encoding === "dynamic_array") {
                name(frame.base, frame, ".length");
                const data = dataSlot(frame.base);
                const stride = slotsOf(type.base!);
                const end = data + BigInt(ARRAY_ELEMENTS) * stride;
                // the elements holding a target, each walked once
                const walked = new Set<bigint>();
                for (
                    let target = targetIn(sortedTargets, data, end);
                    target !== undefined;
                    target = targetIn(sortedTargets, target + 1n, end)
                ) {
                    const index = (target - data) / stride;
                    if (walked.has(index)) continue;
                    walked.add(index);
                    stack.push({
                        ...frame,
                        type: type.base!,
                        base: data + index * stride,
                        path: `${frame.path}[${index}]`
                    });
                }
            } else {
                name(frame.base, frame);
                const data = dataSlot(frame.base);
                const end = data + BigInt(ARRAY_ELEMENTS);
                for (
                    let target = targetIn(sortedTargets, data, end);
                    target !== undefined;
                    target = targetIn(sortedTargets, target + 1n, end)
                )
                    name(target, frame, `.data[${target - data}]`);
            }
        }
        frames = next;
    }
    return { names, truncatedAtDepth };
}

/** One subscription's partition as the peer's light client holds it. */
type HeldPartition = {
    block?: { hash: string; number: number };
    keys: Set<TrieKey>;
};

/** A proof request with what it found. */
type ProofOutcome = {
    peer: number;
    sequence: number;
    at: number;
    block: string | null;
    context: Context;
    /** Ms since the newest accepted push was recorded, if there is one. */
    msSinceNewestPush: number | null;
    keys: { key: TrieKey; keyClass: KeyClass; detail: string }[];
};

type PeerAnalysis = {
    proofs: ProofOutcome[];
    headers: number;
    acceptedPushes: number;
    refusedPushes: number;
    /** The peer's light client's own count of accepted pushes, or null without counters. */
    countedAcceptedPushes: number | null;
    countedRefusedPushes: number | null;
    reads: { fromPushedState: number; withFallbackRead: number } | null;
};

type Classifier = {
    managerSlot: (slot: SlotWord) => SlotName | undefined;
    selectors: Map<string, string>;
};

function classify(
    parsed: ParsedKey,
    peer: FlowBenchPeer,
    labels: FlowBenchLabels | null,
    allPeers: Set<Address>,
    followed: Set<Word>,
    classifier: Classifier
): { keyClass: KeyClass; detail: string } {
    if (parsed.kind === "environment")
        return { keyClass: "environment", detail: "Ethereum.CurrentBlock" };
    if (parsed.kind === "other") return { keyClass: "otherKey", detail: "" };
    const manager = labels?.stateChannelManager;
    const slotAddresses = new Map<Address, string>(
        Object.entries(labels?.managerAddressSlots ?? {}).map(
            ([slot, address]) => [address, `slot ${slot}`]
        )
    );
    const stateMachine = labels?.managerAddressSlots[6];
    const { address } = parsed;
    if (parsed.kind === "storage") {
        if (address === manager) {
            const slot = BigInt(parsed.slot);
            if (slot <= LAST_CONFIG_SLOT)
                return {
                    keyClass: "managerConfig",
                    detail: `slot ${slot}`
                };
            if (slot <= LAST_ADDRESS_SLOT)
                return {
                    keyClass: "managerAddressSlots",
                    detail: `slot ${slot}`
                };
            const named = classifier.managerSlot(parsed.slot);
            if (!named)
                return { keyClass: "managerUnresolved", detail: parsed.slot };
            if (named.variable === "selectorRoutes") {
                const selector = named.firstKey?.slice(0, 10) ?? "";
                return {
                    keyClass: "managerRoutes",
                    detail: classifier.selectors.get(selector) ?? selector
                };
            }
            if (named.variable === "openChannelIds")
                return {
                    keyClass: "managerOpenChannelList",
                    detail: named.path
                };
            return {
                keyClass:
                    named.firstKey !== undefined && followed.has(named.firstKey)
                        ? "managerFollowedChannel"
                        : "managerOtherChannelOrKey",
                detail: named.path.replace(/\[0x[0-9a-f]{64}\]/g, "[<word>]")
            };
        }
        if (address === stateMachine)
            return { keyClass: "stateMachineStorage", detail: address };
        return { keyClass: "otherContract", detail: `storage ${address}` };
    }
    if (address === manager)
        return { keyClass: "managerCodeAccount", detail: parsed.kind };
    if (slotAddresses.has(address))
        return {
            keyClass: "facetOrStateMachineCodeAccount",
            detail: `${parsed.kind} ${slotAddresses.get(address)}`
        };
    if (address === peer.address)
        return { keyClass: "ownAccount", detail: parsed.kind };
    if (allPeers.has(address))
        return { keyClass: "otherPeerAccount", detail: parsed.kind };
    if (address === ZERO_ADDRESS)
        return { keyClass: "zeroAddressAccount", detail: parsed.kind };
    if (labels?.hasCode[address] === false)
        return { keyClass: "otherAccount", detail: parsed.kind };
    return { keyClass: "otherContract", detail: `${parsed.kind} ${address}` };
}

/** Rebuilds the peer's partitions and places every proof request against them. */
function analyzePeer(
    peer: FlowBenchPeer,
    labels: FlowBenchLabels | null,
    allPeers: Set<Address>,
    classifier: Classifier
): PeerAnalysis {
    const { trace } = peer;
    const followed = new Set(trace.subscribes.flatMap(({ topics }) => topics));
    // subscription id -> its partition, while the light client hands its pushes on
    const partitions = new Map<string, HeldPartition>();
    // subscription ids the light client no longer hands on
    const ended = new Set<string>();
    // block hash -> the sequence of the first push of it
    const firstPushOf = new Map<string, number>();
    for (const push of trace.pushes)
        if (!push.isError && !firstPushOf.has(push.hash))
            firstPushOf.set(push.hash, push.sequence);
    type Event =
        | { sequence: number; kind: "push"; index: number }
        | { sequence: number; kind: "unsubscribe"; index: number }
        | { sequence: number; kind: "proof"; index: number };
    const events: Event[] = [
        ...trace.pushes.map((push, index) => ({
            sequence: push.sequence,
            kind: "push" as const,
            index
        })),
        ...trace.unsubscribes.map((unsubscribe, index) => ({
            sequence: unsubscribe.sequence,
            kind: "unsubscribe" as const,
            index
        })),
        ...trace.proofs.map((proof, index) => ({
            sequence: proof.sequence,
            kind: "proof" as const,
            index
        }))
    ].sort((a, b) => a.sequence - b.sequence);
    let accepted = 0;
    let refused = 0;
    let newestPushAt: number | null = null;
    const proofs: ProofOutcome[] = [];
    for (const event of events) {
        if (event.kind === "unsubscribe") {
            const id = trace.unsubscribes[event.index].subscription;
            ended.add(id);
            partitions.delete(id);
            continue;
        }
        if (event.kind === "push") {
            const push = trace.pushes[event.index];
            if (ended.has(push.subscription)) continue;
            if (push.isError) {
                // the light client opens the subscription again
                ended.add(push.subscription);
                partitions.delete(push.subscription);
                continue;
            }
            const held = partitions.get(push.subscription) ?? {
                keys: new Set<TrieKey>()
            };
            partitions.set(push.subscription, held);
            if (!push.sync && !held.block) {
                refused++;
                held.keys = new Set();
                // the light client reopens it after a refusal
                ended.add(push.subscription);
                partitions.delete(push.subscription);
                continue;
            }
            if (!push.sync && held.block) {
                if (push.hash === held.block.hash) continue;
                if (push.number < held.block.number) {
                    refused++;
                    ended.add(push.subscription);
                    partitions.delete(push.subscription);
                    continue;
                }
            }
            if (push.sync) held.keys = new Set();
            for (const key of push.keys) held.keys.add(key);
            held.block = { hash: push.hash, number: push.number };
            accepted++;
            newestPushAt = push.at;
            continue;
        }
        const proof = trace.proofs[event.index];
        let newest: HeldPartition["block"];
        for (const held of partitions.values())
            if (held.block && held.block.number > (newest?.number ?? -1))
                newest = held.block;
        let context: Context;
        if (proof.block === null) context = "atBestBlock";
        else if (newest && proof.block === newest.hash)
            context = "atPushedBlock";
        else if (!newest) context = "beforeFirstPush";
        else {
            const first = firstPushOf.get(proof.block);
            context =
                first === undefined
                    ? "atUnpushedBlockNeverPushed"
                    : first < proof.sequence
                      ? "atSupersededPushedBlock"
                      : "atUnpushedBlockPushedLater";
        }
        const holding = [...partitions.values()].filter(
            (held) => held.block?.hash === proof.block
        );
        proofs.push({
            peer: peer.peer,
            sequence: proof.sequence,
            at: proof.at,
            block: proof.block,
            context,
            msSinceNewestPush:
                newestPushAt === null ? null : proof.at - newestPushAt,
            keys: proof.keys.map((key) => {
                if (holding.some((held) => held.keys.has(key)))
                    return { key, keyClass: "inPartition", detail: "" };
                return {
                    key,
                    ...classify(
                        parseKey(key),
                        peer,
                        labels,
                        allPeers,
                        followed,
                        classifier
                    )
                };
            })
        });
    }
    return {
        proofs,
        headers: trace.headers.length,
        acceptedPushes: accepted,
        refusedPushes: refused,
        countedAcceptedPushes: peer.counts?.pushedState.acceptedBlocks ?? null,
        countedRefusedPushes: peer.counts?.pushedState.refusedBlocks ?? null,
        reads: peer.counts
            ? {
                  fromPushedState: peer.counts.lightClient.fromPushedState,
                  withFallbackRead: peer.counts.lightClient.withFallbackRead
              }
            : null
    };
}

/** The metrics of one run of one flow. */
type RunMetrics = {
    file: string;
    proofRequests: number;
    headerRequests: number;
    reads: { fromPushedState: number; withFallbackRead: number };
    byContext: Record<Context, number>;
    keyProofs: Record<KeyClass, number>;
    distinctKeys: Record<KeyClass, number>;
    requestsWithClass: Record<KeyClass, number>;
    requestsLeft: { name: string; requests: number }[];
    contextForcedRequests: number;
    keyProofsProvenEarlierAtAnotherBlock: Record<KeyClass, number>;
    requestsAllProvenEarlier: number;
    details: Record<KeyClass, Record<string, number>>;
    unexpected: ProofOutcome[];
    pushReconstruction: {
        peer: number;
        rebuiltAccepted: number;
        countedAccepted: number | null;
        rebuiltRefused: number;
        countedRefused: number | null;
    }[];
    slotSearch: { unresolvedSlots: number; truncatedAtDepth: number | null };
};

function zeroed<K extends string>(keys: readonly K[]): Record<K, number> {
    return Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;
}

function analyzeRun(
    name: string,
    file: FlowFile,
    layout: Layout,
    selectors: Map<string, string>
): RunMetrics {
    const keyAddresses = new Set<Address>();
    const managerSlots = new Set<SlotWord>();
    for (const peer of file.peers)
        for (const proof of peer.trace.proofs)
            for (const key of proof.keys) {
                const parsed = parseKey(key);
                if (
                    parsed.kind === "storage" ||
                    parsed.kind === "code" ||
                    parsed.kind === "account"
                )
                    keyAddresses.add(parsed.address);
                if (
                    parsed.kind === "storage" &&
                    parsed.address === file.labels?.stateChannelManager &&
                    BigInt(parsed.slot) > LAST_ADDRESS_SLOT
                )
                    managerSlots.add(parsed.slot);
            }
    const pools = buildPools(file, selectors, keyAddresses);
    const resolved = resolveSlots(layout, pools, pools.bytes32, managerSlots);
    const { names } = resolved;
    let { truncatedAtDepth } = resolved;
    // a search cut short goes again with only the channel ids as first keys
    if (truncatedAtDepth !== null && names.size < managerSlots.size) {
        const unresolved = new Set(
            [...managerSlots].filter((slot) => !names.has(slot))
        );
        const again = resolveSlots(layout, pools, pools.channelIds, unresolved);
        for (const [slot, slotName] of again.names) names.set(slot, slotName);
        truncatedAtDepth = again.truncatedAtDepth;
    }
    const classifier: Classifier = {
        managerSlot: (slot) => names.get(slot),
        selectors
    };
    const allPeers = new Set(file.peers.map((peer) => peer.address));
    const analyses = file.peers.map((peer) =>
        analyzePeer(peer, file.labels, allPeers, classifier)
    );
    const metrics: RunMetrics = {
        file: name,
        proofRequests: 0,
        headerRequests: 0,
        reads: { fromPushedState: 0, withFallbackRead: 0 },
        byContext: zeroed(CONTEXTS),
        keyProofs: zeroed(KEY_CLASSES),
        distinctKeys: zeroed(KEY_CLASSES),
        requestsWithClass: zeroed(KEY_CLASSES),
        requestsLeft: [],
        contextForcedRequests: 0,
        keyProofsProvenEarlierAtAnotherBlock: zeroed(KEY_CLASSES),
        requestsAllProvenEarlier: 0,
        details: Object.fromEntries(
            KEY_CLASSES.map((keyClass) => [keyClass, {}])
        ) as Record<KeyClass, Record<string, number>>,
        unexpected: [],
        pushReconstruction: [],
        slotSearch: {
            unresolvedSlots: managerSlots.size - names.size,
            truncatedAtDepth
        }
    };
    const distinct = Object.fromEntries(
        KEY_CLASSES.map((keyClass) => [keyClass, new Set<string>()])
    ) as Record<KeyClass, Set<string>>;
    const covered: Set<KeyClass>[] = [];
    let cumulative = new Set<KeyClass>();
    for (const hypothesis of HYPOTHESES) {
        cumulative = new Set([...cumulative, ...hypothesis.adds]);
        covered.push(cumulative);
    }
    const left = HYPOTHESES.map(() => 0);
    analyses.forEach((analysis, index) => {
        const peer = file.peers[index];
        metrics.pushReconstruction.push({
            peer: peer.peer,
            rebuiltAccepted: analysis.acceptedPushes,
            countedAccepted: analysis.countedAcceptedPushes,
            rebuiltRefused: analysis.refusedPushes,
            countedRefused: analysis.countedRefusedPushes
        });
        metrics.headerRequests += analysis.headers;
        if (analysis.reads) {
            metrics.reads.fromPushedState += analysis.reads.fromPushedState;
            metrics.reads.withFallbackRead += analysis.reads.withFallbackRead;
        }
        // key -> the block hashes this peer had it proven at, so far
        const provenAt = new Map<TrieKey, Set<string | null>>();
        for (const proof of analysis.proofs) {
            metrics.proofRequests++;
            metrics.byContext[proof.context]++;
            const classes = new Set(proof.keys.map(({ keyClass }) => keyClass));
            for (const keyClass of classes)
                metrics.requestsWithClass[keyClass]++;
            let allEarlier = proof.keys.length > 0;
            for (const { key, keyClass, detail } of proof.keys) {
                metrics.keyProofs[keyClass]++;
                distinct[keyClass].add(key);
                const label = detail || "-";
                metrics.details[keyClass][label] =
                    (metrics.details[keyClass][label] ?? 0) + 1;
                const blocks = provenAt.get(key) ?? new Set();
                const earlierElsewhere = [...blocks].some(
                    (block) => block !== proof.block
                );
                if (earlierElsewhere)
                    metrics.keyProofsProvenEarlierAtAnotherBlock[keyClass]++;
                else allEarlier = false;
                blocks.add(proof.block);
                provenAt.set(key, blocks);
            }
            if (allEarlier) metrics.requestsAllProvenEarlier++;
            if (classes.has("inPartition")) metrics.unexpected.push(proof);
            if (proof.context !== "atPushedBlock") {
                metrics.contextForcedRequests++;
                HYPOTHESES.forEach((_, h) => left[h]++);
                continue;
            }
            HYPOTHESES.forEach((_, h) => {
                if (
                    proof.keys.some(
                        ({ keyClass }) =>
                            keyClass !== "inPartition" &&
                            !covered[h].has(keyClass)
                    )
                )
                    left[h]++;
            });
        }
    });
    for (const keyClass of KEY_CLASSES)
        metrics.distinctKeys[keyClass] = distinct[keyClass].size;
    metrics.requestsLeft = HYPOTHESES.map((hypothesis, h) => ({
        name: hypothesis.name,
        requests: left[h]
    }));
    return metrics;
}

/** The requests other than proofs and headers in one run of one flow. */
type RequestMetrics = {
    file: string;
    /** Requests by JSON-RPC method. */
    byMethod: Record<string, number>;
    /** Requests by what they asked and how the node replied: see `requestShape`. */
    byShape: Record<string, number>;
    /** Reads of a light client method that its parser takes, which therefore reached the node from the light client. */
    localReadsTried: number;
    /** Of those, the ones of peers with counts, which the counts must match. */
    checkedReadsTried: number;
    /** The light clients' reads left to the nodes, failed or unsupported, over the peers with counts; null with the light client off. */
    countedNotLocal: number | null;
    /** Peers whose runtime was gone or whose provider was not the light client's at cleanup. */
    peersWithoutCounts: number;
};

/**
 * A block tag as a request names it: a block number other than 0 and 1
 * reads "a block number", so that runs whose blocks differ group alike.
 */
function tagLabel(tag: unknown): string {
    if (tag === undefined) return '"latest"';
    if (typeof tag === "string" && /^0x[0-9a-fA-F]+$/.test(tag))
        return BigInt(tag) <= 1n ? `block ${BigInt(tag)}` : "a block number";
    return JSON.stringify(tag);
}

/** Who `address` is to the flow. */
function addressLabel(
    address: unknown,
    peer: FlowBenchPeer,
    labels: FlowBenchLabels | null
): string {
    // a log filter names its contracts as a list
    if (Array.isArray(address))
        return address.map((one) => addressLabel(one, peer, labels)).join("+");
    if (typeof address !== "string") return "no address";
    const lower = address.toLowerCase();
    if (lower === labels?.stateChannelManager) return "manager";
    if (lower === peer.address) return "own";
    if (lower === ZERO_ADDRESS) return "zero";
    for (const [slot, held] of Object.entries(
        labels?.managerAddressSlots ?? {}
    ))
        if (held === lower) return `manager slot ${slot} contract`;
    return lower;
}

/** The node's reply, reduced to whether it answered, reverted or failed. */
function replyLabel(
    reply: FlowBenchPeer["trace"]["others"][number]["reply"]
): string {
    if (reply === undefined) return "no reply";
    if (reply === "result") return "result";
    const { error } = reply;
    if (typeof error !== "object" || error === null) return "error";
    const { code, message, data } = error as Record<string, unknown>;
    if (typeof data === "string" && data.startsWith("0x")) return "reverted";
    return `error ${String(code)} ${String(message).slice(0, 60)}`;
}

/**
 * What a request asked, to group it by: the called contract and function
 * for calls, the block tag and the address's role for account reads, the
 * kind of subscription, the storage map of a raw storage read. A read of a
 * light client method says whether the SDK's parser takes it ("tried
 * locally": the light client ran it and left it to the node) or not ("node
 * only", with the tag and fields that decided it).
 */
function requestShape(
    method: string,
    params: unknown,
    reply: FlowBenchPeer["trace"]["others"][number]["reply"],
    peer: FlowBenchPeer,
    labels: FlowBenchLabels | null,
    selectors: Map<string, string>,
    lightClientOn: boolean
): { shape: string; triedLocally: boolean } {
    const list: unknown[] = Array.isArray(params) ? params : [params];
    const field = (value: unknown, name: string): unknown =>
        typeof value === "object" && value !== null
            ? (value as Record<string, unknown>)[name]
            : undefined;
    let route = "";
    let triedLocally = false;
    if (LOCAL_READ_METHODS.has(method)) {
        const parsed = parseLocalRead({
            jsonrpc: "2.0",
            id: 0,
            method,
            params: list
        });
        const tagIndex = method === "eth_getStorageAt" ? 2 : 1;
        const tag = tagLabel(list[tagIndex]);
        if (!parsed) {
            const tx = list[0];
            const fields =
                method === "eth_call" && typeof tx === "object" && tx !== null
                    ? ` fields ${Object.keys(tx).sort().join(",")}`
                    : "";
            route = ` [node only: tag ${tag}${fields}]`;
        } else if (lightClientOn) {
            triedLocally = true;
            const value = field(list[0], "value");
            route =
                method === "eth_call" &&
                typeof value === "string" &&
                BigInt(value) !== 0n
                    ? " [tried locally: carries value]"
                    : " [tried locally]";
        } else route = " [light client would try it]";
    }
    let what = "";
    if (method === "eth_call" || method === "eth_estimateGas") {
        const tx = list[0];
        const data = field(tx, "data") ?? field(tx, "input");
        const selector =
            typeof data === "string" && data.length >= 10
                ? data.slice(0, 10).toLowerCase()
                : undefined;
        const name = selector
            ? (selectors.get(selector) ?? selector)
            : "no data";
        what = ` ${addressLabel(field(tx, "to"), peer, labels)}.${name} from ${addressLabel(field(tx, "from"), peer, labels)}`;
    } else if (
        method === "eth_getTransactionCount" ||
        method === "eth_getBalance" ||
        method === "eth_getCode"
    )
        what = ` ${addressLabel(list[0], peer, labels)}`;
    else if (method === "eth_getStorageAt")
        what = ` ${addressLabel(list[0], peer, labels)} slot ${String(list[1])}`;
    else if (
        method === "eth_getBlockByNumber" ||
        method === "eth_getBlockByHash"
    )
        what = ` ${method === "eth_getBlockByNumber" ? `tag ${tagLabel(list[0])}` : "by hash"} full ${String(list[1])}`;
    else if (method === "eth_subscribe")
        what = ` ${String(list[0])}${list[0] === "logs" ? ` ${addressLabel(field(list[1], "address"), peer, labels)}` : ""}`;
    else if (method === "state_getStorage")
        what = ` map ${typeof list[0] === "string" ? list[0].slice(0, 66) : "?"}`;
    return {
        shape: `${method}${what}${route} -> ${replyLabel(reply)}`,
        triedLocally
    };
}

function analyzeRequests(
    name: string,
    file: FlowFile,
    selectors: Map<string, string>,
    lightClientOn: boolean
): RequestMetrics {
    const metrics: RequestMetrics = {
        file: name,
        byMethod: {},
        byShape: {},
        localReadsTried: 0,
        checkedReadsTried: 0,
        countedNotLocal: lightClientOn ? 0 : null,
        peersWithoutCounts: 0
    };
    for (const peer of file.peers) {
        const triedBefore = metrics.localReadsTried;
        for (const { method, params, reply } of peer.trace.others) {
            metrics.byMethod[method] = (metrics.byMethod[method] ?? 0) + 1;
            const { shape, triedLocally } = requestShape(
                method,
                params,
                reply,
                peer,
                file.labels,
                selectors,
                lightClientOn
            );
            metrics.byShape[shape] = (metrics.byShape[shape] ?? 0) + 1;
            if (triedLocally) metrics.localReadsTried++;
        }
        const counters = peer.counts?.lightClient;
        if (!counters) metrics.peersWithoutCounts++;
        else if (metrics.countedNotLocal !== null) {
            metrics.checkedReadsTried += metrics.localReadsTried - triedBefore;
            metrics.countedNotLocal +=
                counters.leftToNodes + counters.failed + counters.unsupported;
        }
    }
    return metrics;
}

function loadLayout(): Layout {
    const json = execFileSync(
        "forge",
        ["inspect", "StateChannelManagerProxy", "storageLayout", "--json"],
        { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
    );
    return JSON.parse(json) as Layout;
}

function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** `median (min-max)` of a number across runs. */
function spread(values: number[]): string {
    if (values.length === 0) return "-";
    const min = Math.min(...values);
    const max = Math.max(...values);
    const mid = median(values);
    const format = (n: number) =>
        Number.isInteger(n) ? String(n) : n.toFixed(2);
    return min === max
        ? format(mid)
        : `${format(mid)} (${format(min)}-${format(max)})`;
}

type DriverRun = {
    file: string;
    passed: boolean;
    nodeCpuSeconds: number;
    nodeProcesses: number;
    totalRequests?: number;
    proofRequests?: number;
};

/** The off and on runs' requests other than proofs and headers, of one flow. */
type FlowRequests = { off: RequestMetrics[]; on: RequestMetrics[] };

/** Lines for the requests other than proofs and headers, off against on. */
function requestLines(requests: FlowRequests | undefined): string[] {
    if (!requests) return [];
    const { off, on } = requests;
    const column = (
        runs: RequestMetrics[],
        pick: (r: RequestMetrics) => number
    ) => (runs.length ? spread(runs.map(pick)) : "-");
    const table = (
        heading: string,
        keysOf: (r: RequestMetrics) => Record<string, number>
    ): string[] => {
        const totals = new Map<string, number>();
        for (const run of [...off, ...on])
            for (const [key, count] of Object.entries(keysOf(run)))
                totals.set(key, (totals.get(key) ?? 0) + count);
        return [
            `| ${heading} | off | on |`,
            "|---|---|---|",
            ...[...totals]
                .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
                .map(
                    ([key]) =>
                        `| ${key.replace(/\|/g, "\\|")} | ${column(off, (r) => keysOf(r)[key] ?? 0)} | ${column(on, (r) => keysOf(r)[key] ?? 0)} |`
                )
        ];
    };
    const total = (r: RequestMetrics) =>
        Object.values(r.byMethod).reduce((n, count) => n + count, 0);
    const mismatches = on
        .filter((r) => r.countedNotLocal !== r.checkedReadsTried)
        .map(
            (r) =>
                `${r.file}: ${r.checkedReadsTried} tried, counters ${r.countedNotLocal}`
        );
    const unchecked = on
        .filter((r) => r.peersWithoutCounts > 0)
        .map(
            (r) =>
                `${r.file}: ${r.peersWithoutCounts} peers, ${r.localReadsTried - r.checkedReadsTried} reads tried`
        );
    return [
        "### Requests other than proofs and headers",
        "",
        `Total: off ${column(off, total)}, on ${column(on, total)}.`,
        "",
        ...table("method", (r) => r.byMethod),
        "",
        "<details><summary>By what they asked and how the node replied</summary>",
        "",
        ...table("request", (r) => r.byShape),
        "",
        "</details>",
        "",
        `Reads the light client tried and left to the node: ${column(on, (r) => r.localReadsTried)}; they match its counters (left to nodes + failed + unsupported) over the peers with counts: ${mismatches.length === 0 ? "yes, every run" : `NO: ${mismatches.join("; ")}`}.${unchecked.length ? ` Peers without counts, not checked: ${unchecked.join("; ")}.` : ""}`,
        ""
    ];
}

function report(
    dir: string,
    byFlow: Map<string, RunMetrics[]>,
    driver: Record<string, Record<string, DriverRun[] | unknown>>,
    requestsByFlow: Map<string, FlowRequests>
): string {
    const lines: string[] = [
        "# Light client flow breakdown",
        "",
        `Results: ${dir}. Numbers are the median over the runs, with min-max when they differ; requests are summed over the flow's peers.`,
        ""
    ];
    for (const [flow, runs] of byFlow) {
        const flowDriver = driver[flow] ?? {};
        const off = (flowDriver.off as DriverRun[] | undefined) ?? [];
        const on = (flowDriver.on as DriverRun[] | undefined) ?? [];
        lines.push(`## ${flow}`, "");
        lines.push(
            "| | off | on |",
            "|---|---|---|",
            `| runs passed | ${off.filter((r) => r.passed).length}/${off.length} | ${on.filter((r) => r.passed).length}/${on.length} |`,
            `| requests | ${spread(off.flatMap((r) => r.totalRequests ?? []))} | ${spread(on.flatMap((r) => r.totalRequests ?? []))} |`,
            `| node CPU s | ${spread(off.map((r) => r.nodeCpuSeconds))} | ${spread(on.map((r) => r.nodeCpuSeconds))} |`,
            `| node processes | ${spread(off.map((r) => r.nodeProcesses))} | ${spread(on.map((r) => r.nodeProcesses))} |`,
            ""
        );
        const values = (pick: (run: RunMetrics) => number) =>
            spread(runs.map(pick));
        lines.push(
            `Light client reads: ${values((r) => r.reads.fromPushedState)} from pushed state, ${values((r) => r.reads.withFallbackRead)} with a fallback read. Proof requests ${values((r) => r.proofRequests)}, header requests ${values((r) => r.headerRequests)}.`,
            ""
        );
        lines.push("| proof requests by read block | requests |", "|---|---|");
        for (const context of CONTEXTS)
            lines.push(
                `| ${CONTEXT_NAMES[context]} | ${values((r) => r.byContext[context])} |`
            );
        lines.push(
            "",
            "| key class | key proofs | distinct keys | requests with it | proven earlier at another block |",
            "|---|---|---|---|---|"
        );
        for (const keyClass of KEY_CLASSES) {
            if (runs.every((r) => r.keyProofs[keyClass] === 0)) continue;
            lines.push(
                `| ${KEY_CLASS_NAMES[keyClass]} | ${values((r) => r.keyProofs[keyClass])} | ${values((r) => r.distinctKeys[keyClass])} | ${values((r) => r.requestsWithClass[keyClass])} | ${values((r) => r.keyProofsProvenEarlierAtAnotherBlock[keyClass])} |`
            );
        }
        lines.push(
            "",
            `Requests whose every key the peer had proven before at another block: ${values((r) => r.requestsAllProvenEarlier)}.`,
            "",
            "| if the partition also held | proof requests left |",
            "|---|---|"
        );
        HYPOTHESES.forEach((hypothesis, h) =>
            lines.push(
                `| ${hypothesis.name} | ${values((r) => r.requestsLeft[h].requests)} |`
            )
        );
        lines.push(
            "",
            `Not at a pushed block, so no pushed key helps: ${values((r) => r.contextForcedRequests)}.`,
            ""
        );
        const details = new Map<string, number>();
        for (const run of runs)
            for (const keyClass of [
                "managerRoutes",
                "managerFollowedChannel",
                "managerOtherChannelOrKey",
                "managerConfig",
                "managerAddressSlots",
                "otherContract"
            ] as const)
                for (const [detail, count] of Object.entries(
                    run.details[keyClass]
                ))
                    details.set(
                        `${keyClass}: ${detail}`,
                        (details.get(`${keyClass}: ${detail}`) ?? 0) + count
                    );
        lines.push(
            "<details><summary>Key proofs by detail, summed over the runs</summary>",
            "",
            ...[...details]
                .sort((a, b) => b[1] - a[1])
                .map(([detail, count]) => `- ${detail}: ${count}`),
            "",
            "</details>",
            ""
        );
        const unexpected = runs.flatMap((run) =>
            run.unexpected.map((proof) => ({ file: run.file, proof }))
        );
        lines.push(
            `Proof requests asking for a key the partition held at the read block: ${unexpected.length}.`
        );
        for (const { file, proof } of unexpected)
            lines.push(
                `- ${file} peer ${proof.peer} seq ${proof.sequence}: ${proof.keys.filter((k) => k.keyClass === "inPartition").length} of ${proof.keys.length} keys held, ${proof.msSinceNewestPush ?? "?"} ms after the newest push`
            );
        const mismatches = runs.flatMap((run) =>
            run.pushReconstruction
                .filter(
                    (p) =>
                        p.countedAccepted !== null &&
                        (p.countedAccepted !== p.rebuiltAccepted ||
                            p.countedRefused !== p.rebuiltRefused)
                )
                .map((p) => `${run.file} peer ${p.peer}`)
        );
        lines.push(
            "",
            `Rebuilt pushes match the light clients' counts: ${mismatches.length === 0 ? "yes, every peer" : `NO: ${mismatches.join(", ")}`}. Manager slots unresolved: ${values((r) => r.slotSearch.unresolvedSlots)}${runs.some((r) => r.slotSearch.truncatedAtDepth !== null) ? " (search truncated)" : ""}.`,
            ""
        );
        lines.push(...requestLines(requestsByFlow.get(flow)));
    }
    return lines.join("\n");
}

/**
 * Checks the analysis on a made-up peer: a request at the pushed block for a
 * key the push carried is flagged, one before any push and one for a key
 * outside the partition are not.
 */
function selfTest(layout: Layout): void {
    const block = `0x${"11".repeat(32)}`;
    const manager = `0x${"aa".repeat(20)}`;
    const held = `${STORAGE_PREFIX}${"00".repeat(16)}${manager.slice(2)}${"00".repeat(16)}${"00".repeat(31)}10`;
    const outside = `${ACCOUNT_PREFIX}${"00".repeat(16)}${"bb".repeat(20)}`;
    const peer: FlowBenchPeer = {
        peer: 0,
        address: `0x${"bb".repeat(20)}`,
        requests: {},
        requestBytes: 0,
        replyBytes: 0,
        counts: null,
        provenKeys: {},
        words: [],
        trace: {
            proofs: [
                { sequence: 1, at: 1, block, keys: [held] },
                { sequence: 4, at: 4, block, keys: [held, outside] },
                { sequence: 5, at: 5, block: null, keys: [outside] }
            ],
            headers: [],
            subscribes: [
                { sequence: 0, at: 0, address: manager, topics: [block] }
            ],
            unsubscribes: [],
            pushes: [
                {
                    sequence: 2,
                    at: 2,
                    subscription: "s",
                    isError: false,
                    sync: true,
                    number: 1,
                    hash: block,
                    keys: [held]
                },
                {
                    sequence: 3,
                    at: 3,
                    subscription: "s",
                    isError: false,
                    sync: false,
                    number: 1,
                    hash: block,
                    keys: []
                }
            ],
            others: []
        }
    };
    const labels: FlowBenchLabels = {
        stateChannelManager: manager,
        managerAddressSlots: {},
        hasCode: {}
    };
    const analysis = analyzePeer(peer, labels, new Set([peer.address]), {
        managerSlot: () => undefined,
        selectors: new Map()
    });
    const [first, second, third] = analysis.proofs;
    const check = (condition: boolean, message: string) => {
        if (!condition) throw new Error(`self-test: ${message}`);
    };
    check(
        first.context === "beforeFirstPush",
        "first request is before any push"
    );
    check(
        first.keys[0].keyClass === "managerUnresolved",
        "a manager slot past 15 no layout name reaches is unresolved"
    );
    check(
        second.context === "atPushedBlock",
        "second request is at the pushed block"
    );
    check(second.keys[0].keyClass === "inPartition", "held key is flagged");
    check(
        second.keys[1].keyClass === "ownAccount",
        "own account is classified"
    );
    check(
        third.context === "atBestBlock",
        "request without a hash is at the best block"
    );
    check(
        analysis.acceptedPushes === 1,
        "the same block pushed again is not accepted twice"
    );

    // the layout search names slots computed here by hand
    const channel = `0x${"cc".repeat(32)}`;
    const window = `0x${"dd".repeat(32)}`;
    const selector = "0x12345678";
    const word = (hex: string) => hexBytes(hex);
    const route = mappingSlot(
        word(`0x${selector.slice(2).padEnd(64, "0")}`),
        24n
    );
    const deposits = mappingSlot(word(channel), 16n) + 3n;
    const participant = dataSlot(mappingSlot(word(channel), 18n) + 2n) + 1n;
    const hasPosted =
        mappingSlot(word(window), mappingSlot(word(channel), 22n) + 1n) + 4n;
    const expected = new Map<SlotWord, string>([
        [wordHex(route), "selectorRoutes[f].facet"],
        [wordHex(deposits), "channelBalances[<channel>].totalDeposits.amount"],
        [
            wordHex(participant),
            "stateSnapshots[<channel>].snapshotData.participants[1]"
        ],
        [
            wordHex(hasPosted),
            `disputeData[<channel>].disputeWindowMap[${window}].evidence.hasPosted.length`
        ]
    ]);
    const pools: Pools = {
        channelIds: [{ ...leftPadded(channel), name: "<channel>" }],
        bytes32: [
            { ...leftPadded(channel), name: "<channel>" },
            leftPadded(window)
        ],
        addresses: [],
        selectors: [rightPadded(selector, "f")],
        integers: []
    };
    const { names } = resolveSlots(
        layout,
        pools,
        pools.bytes32,
        new Set(expected.keys())
    );
    for (const [slot, path] of expected)
        check(
            names.get(slot)?.path === path,
            `${path} is named (got ${names.get(slot)?.path})`
        );
    check(
        names.get(wordHex(route))?.firstKey ===
            `0x${selector.slice(2).padEnd(64, "0")}`,
        "a route's first key is its selector"
    );

    // the other requests: what the parser takes, and the counters it must match
    const own = peer.address;
    const requestsPeer: FlowBenchPeer = {
        ...peer,
        counts: {
            lightClient: {
                fromPushedState: 0,
                withFallbackRead: 0,
                leftToNodes: 1,
                failed: 1,
                unsupported: 0
            },
            pushedState: {
                acceptedBlocks: 0,
                refusedBlocks: 0,
                resubscriptions: 0
            },
            readComparisons: { matched: 0, differed: 0, notCompared: 0 }
        },
        trace: {
            ...peer.trace,
            others: [
                {
                    sequence: 10,
                    at: 10,
                    method: "eth_call",
                    params: [{ to: manager, data: selector, value: "0x1" }],
                    reply: "result"
                },
                {
                    sequence: 11,
                    at: 11,
                    method: "eth_call",
                    params: [{ to: manager, data: selector, gas: "0x1" }],
                    reply: { error: { code: 3, message: "x", data: "0x01" } }
                },
                {
                    sequence: 12,
                    at: 12,
                    method: "eth_getTransactionCount",
                    params: [own, "pending"],
                    reply: "result"
                },
                {
                    sequence: 13,
                    at: 13,
                    method: "eth_getBalance",
                    params: [own, "latest"],
                    reply: { error: { code: -32000, message: "boom" } }
                },
                {
                    sequence: 14,
                    at: 14,
                    method: "eth_blockNumber",
                    params: [],
                    reply: undefined
                }
            ]
        }
    };
    const requestFile: FlowFile = { labels, peers: [requestsPeer] };
    const requestSelectors = new Map([[selector, "f"]]);
    const on = analyzeRequests("on", requestFile, requestSelectors, true);
    const expectedShapes = [
        "eth_call manager.f from no address [tried locally: carries value] -> result",
        'eth_call manager.f from no address [node only: tag "latest" fields data,gas,to] -> reverted',
        'eth_getTransactionCount own [node only: tag "pending"] -> result',
        "eth_getBalance own [tried locally] -> error -32000 boom",
        "eth_blockNumber -> no reply"
    ];
    for (const shape of expectedShapes)
        check(on.byShape[shape] === 1, `request shape: ${shape}`);
    check(
        Object.keys(on.byShape).length === expectedShapes.length,
        "no other shapes"
    );
    check(on.byMethod.eth_call === 2, "requests counted by method");
    check(
        on.localReadsTried === 2 &&
            on.checkedReadsTried === 2 &&
            on.countedNotLocal === 2,
        "reads the parser takes match the counters"
    );
    const withoutCounts = analyzeRequests(
        "on",
        { labels, peers: [{ ...requestsPeer, counts: null }, requestsPeer] },
        requestSelectors,
        true
    );
    check(
        withoutCounts.peersWithoutCounts === 1 &&
            withoutCounts.localReadsTried === 4 &&
            withoutCounts.checkedReadsTried === 2 &&
            withoutCounts.countedNotLocal === 2,
        "a peer without counts is left out of the check, not failed"
    );
    const off = analyzeRequests("off", requestFile, requestSelectors, false);
    check(
        off.localReadsTried === 0 && off.countedNotLocal === null,
        "nothing is tried locally with the light client off"
    );
    check(
        off.byShape[
            "eth_getBalance own [light client would try it] -> error -32000 boom"
        ] === 1,
        "with the light client off a read it takes is marked"
    );
    console.log("self-test passed");
}

function main(): void {
    const argument = process.argv[2];
    if (!argument) throw new Error("usage: <results dir> | --self-test");
    const layout = loadLayout();
    if (argument === "--self-test") {
        selfTest(layout);
        return;
    }
    const dir = path.resolve(argument);
    writeFileSync(
        path.join(dir, "scm-storage-layout.json"),
        JSON.stringify(layout, null, 2)
    );
    const selectors = loadSelectors(path.resolve("artifacts", "contracts"));
    const driver = (
        JSON.parse(readFileSync(path.join(dir, "results.json"), "utf8")) as {
            flows: Record<string, Record<string, DriverRun[] | unknown>>;
        }
    ).flows;
    const byFlow = new Map<string, RunMetrics[]>();
    const requestsByFlow = new Map<string, FlowRequests>();
    for (const name of readdirSync(dir).sort()) {
        const match = /^(.+)-(off|on)(?:-\d+)?\.json$/.exec(name);
        if (!match) continue;
        const file = JSON.parse(
            readFileSync(path.join(dir, name), "utf8")
        ) as FlowFile;
        const lightClientOn = match[2] === "on";
        const flowRequests = requestsByFlow.get(match[1]) ?? {
            off: [],
            on: []
        };
        flowRequests[lightClientOn ? "on" : "off"].push(
            analyzeRequests(name, file, selectors, lightClientOn)
        );
        requestsByFlow.set(match[1], flowRequests);
        if (!lightClientOn) continue;
        const metrics = analyzeRun(name, file, layout, selectors);
        const runs = byFlow.get(match[1]) ?? [];
        runs.push(metrics);
        byFlow.set(match[1], runs);
        console.log(
            `${name}: ${metrics.proofRequests} proof requests, ${metrics.unexpected.length} unexpected, ${metrics.slotSearch.unresolvedSlots} unresolved manager slots`
        );
    }
    writeFileSync(
        path.join(dir, "breakdown.json"),
        JSON.stringify(
            {
                proofs: Object.fromEntries(byFlow),
                otherRequests: Object.fromEntries(requestsByFlow)
            },
            null,
            2
        )
    );
    writeFileSync(
        path.join(dir, "breakdown.md"),
        report(dir, byFlow, driver, requestsByFlow)
    );
    console.log(`breakdown: ${path.join(dir, "breakdown.md")}`);
}

main();
