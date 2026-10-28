// @spec-test-coverage-ignore: test-only diagnostic that compares the mirror's local answers with the node's; it asserts nothing itself
import {
    Mirror,
    type MirrorCall,
    type MirrorCallOutcome
} from "@/evm/p2pRuntime/rpcNodes/mirror/Mirror";
import {
    MirrorChain,
    MirrorUnavailableError,
    type MirrorHead
} from "@/evm/p2pRuntime/rpcNodes/mirror/MirrorChain";
import { JsonRpcProvider, toBeHex, toQuantity, zeroPadValue } from "ethers";
import { AsyncLocalStorage } from "node:async_hooks";
import { appendFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { threadId } from "node:worker_threads";

/** The read a count belongs to, named as the RPC method it answers. */
type CheckedMethod =
    | "eth_call"
    | "eth_getStorageAt"
    | "eth_getBalance"
    | "eth_getCode"
    | "eth_getTransactionCount"
    | "eth_blockNumber"
    | "eth_getBlock"
    | "eth_getTransactionByHash"
    | "eth_getTransactionReceipt";

type MethodCounts = {
    matches: number;
    mismatches: number;
    /** The mirror answered older than a block the node already had. */
    stale: number;
    /** The mirror declined and the node answers; nothing to compare. */
    declined: number;
    /** The node was gone (the test was torn down); nothing to compare. */
    unchecked: number;
};

type ShadowStore = { head?: MirrorHead };

/** What a check found: the two answers, as text, when they differ. */
type Verdict = { same: true } | { same: false; mirror: string; node: string };

/** A check against the node; `unchecked` when the node cannot answer. */
type Check<A extends unknown[], R> = (
    node: JsonRpcProvider,
    args: A,
    result: R,
    head: MirrorHead | undefined
) => Promise<Verdict | "unchecked">;

const SAME: Verdict = { same: true };

function text(value: unknown): string {
    return (typeof value === "string" ? value : JSON.stringify(value)).slice(
        0,
        300
    );
}

function verdict(mirror: unknown, node: unknown): Verdict {
    return isDeepStrictEqual(mirror, node)
        ? SAME
        : { same: false, mirror: text(mirror), node: text(node) };
}

function isGone(error: unknown): boolean {
    return /ECONNREFUSED|ECONNRESET|socket hang up/.test(String(error));
}

/** A storage word in its 32-byte form, whichever form a side answers in. */
function word(value: string): string {
    return zeroPadValue(toBeHex(BigInt(value)), 32);
}

/** The error data of a reverted call, if the node sent any. */
function revertData(error: unknown): string | undefined {
    const data = error as {
        data?: unknown;
        info?: { error?: { data?: unknown } };
    };
    const found = data.data ?? data.info?.error?.data;
    return typeof found === "string" && found.startsWith("0x")
        ? found
        : undefined;
}

function describeOutcome(outcome: MirrorCallOutcome): string {
    if (outcome.kind === "return") return `return ${outcome.data}`;
    if (outcome.kind === "revert") return `revert ${outcome.data}`;
    return `failure ${outcome.message}`;
}

async function nodeCall(
    node: JsonRpcProvider,
    request: MirrorCall,
    number: bigint
): Promise<string | "unchecked"> {
    const tx = {
        ...(request.from ? { from: request.from } : {}),
        to: request.to,
        data: request.data,
        ...(request.value === undefined
            ? {}
            : { value: toQuantity(request.value) }),
        ...(request.gas === undefined ? {} : { gas: toQuantity(request.gas) }),
        ...(request.gasPrice === undefined
            ? {}
            : { gasPrice: toQuantity(request.gasPrice) })
    };
    try {
        return `return ${await node.send("eth_call", [tx, toQuantity(number)])}`;
    } catch (error) {
        if (isGone(error)) return "unchecked";
        const data = revertData(error);
        return data
            ? `revert ${data}`
            : `failure ${String((error as Error).message).slice(0, 160)}`;
    }
}

/** One id per runtime thread: the last line of each carries its totals. */
const WRITER = `${process.pid}-${threadId}`;
const FLUSH_EVERY = 20;

let installed = false;
let node: JsonRpcProvider | undefined;

/**
 * Shadow-checks every read the mirror answers locally in this runtime: the
 * same read goes to the node at the block the mirror answered at, and the
 * answers are compared byte for byte (revert data and block objects
 * included). Counts per method, each mismatch, and the duration of every
 * wait for the head are appended to `logPath` as JSON lines. The shadow reads
 * are extra load, so request counts are taken without it. It patches the
 * prototypes of the runtime it runs in: `mirrorShadowPreload.js` puts it into
 * worker threads too.
 */
export function installMirrorShadowCheck(
    nodeUrl: string,
    logPath: string
): void {
    // each harness may run its own node: the checks go to the latest one
    node?.destroy();
    node = new JsonRpcProvider(nodeUrl, undefined, {
        staticNetwork: true,
        batchMaxCount: 1
    });
    if (installed) return;
    installed = true;

    const store = new AsyncLocalStorage<ShadowStore>();
    const counts = new Map<CheckedMethod, MethodCounts>();
    const waitsMs: number[] = [];
    let events = 0;

    const flush = () =>
        appendFileSync(
            logPath,
            JSON.stringify({
                counts: Object.fromEntries(counts),
                waitsMs,
                writer: WRITER
            }) + "\n"
        );
    const countsOf = (method: CheckedMethod): MethodCounts => {
        let entry = counts.get(method);
        if (!entry) {
            entry = {
                matches: 0,
                mismatches: 0,
                stale: 0,
                declined: 0,
                unchecked: 0
            };
            counts.set(method, entry);
        }
        return entry;
    };
    const record = (method: CheckedMethod, outcome: Verdict | "unchecked") => {
        const entry = countsOf(method);
        if (outcome === "unchecked") entry.unchecked++;
        else if (outcome.same) entry.matches++;
        else {
            entry.mismatches++;
            appendFileSync(
                logPath,
                JSON.stringify({ mismatch: { method, ...outcome } }) + "\n"
            );
        }
        if (++events % FLUSH_EVERY === 0) flush();
    };

    /** Wraps the Mirror read `name`: runs it, then compares it with the node. */
    function shadow<A extends unknown[], R>(
        method: CheckedMethod,
        name: keyof Mirror,
        check: Check<A, R>
    ): void {
        const target = Mirror.prototype as unknown as Record<
            string,
            (this: Mirror, ...args: A) => Promise<R>
        >;
        const original = target[name as string];
        target[name as string] = function (this: Mirror, ...args: A) {
            const shadowed: ShadowStore = {};
            return store.run(shadowed, async () => {
                let result: R;
                try {
                    result = await original.apply(this, args);
                } catch (error) {
                    if (error instanceof MirrorUnavailableError)
                        countsOf(method).declined++;
                    throw error;
                }
                try {
                    record(
                        method,
                        await check(node!, args, result, shadowed.head)
                    );
                } catch (error) {
                    record(
                        method,
                        isGone(error)
                            ? "unchecked"
                            : {
                                  same: false,
                                  mirror: text(result),
                                  node: `shadow check failed: ${String(error).slice(0, 160)}`
                              }
                    );
                }
                return result;
            });
        };
    }

    const run = MirrorChain.prototype.run;
    MirrorChain.prototype.run = function <T>(
        this: MirrorChain,
        read: (head: MirrorHead) => Promise<T>
    ): Promise<T> {
        return run.call(this, (head) => {
            const current = store.getStore();
            if (current) current.head = head;
            return read(head);
        }) as Promise<T>;
    };

    // the wait for the head to reach a block the peer saw is a private step
    const waiting = MirrorChain.prototype as unknown as {
        waitForOwnTransactions: () => Promise<void>;
    };
    const wait = waiting.waitForOwnTransactions;
    waiting.waitForOwnTransactions = async function (this: MirrorChain) {
        const started = performance.now();
        await wait.call(this);
        const elapsed = performance.now() - started;
        if (elapsed >= 1) waitsMs.push(Math.round(elapsed));
    };

    shadow<[MirrorCall], MirrorCallOutcome>(
        "eth_call",
        "call",
        async (rpc, [request], outcome, head) => {
            if (!head) return "unchecked";
            const answer = await nodeCall(rpc, request, head.number);
            return answer === "unchecked"
                ? answer
                : verdict(describeOutcome(outcome), answer);
        }
    );
    shadow<[string, string], string>(
        "eth_getStorageAt",
        "getStorageAt",
        async (rpc, [address, slot], result, head) =>
            head
                ? verdict(
                      word(result),
                      word(
                          (await rpc.send("eth_getStorageAt", [
                              address,
                              slot,
                              toQuantity(head.number)
                          ])) as string
                      )
                  )
                : "unchecked"
    );
    shadow<[string], bigint>(
        "eth_getBalance",
        "getBalance",
        async (rpc, [address], result, head) =>
            head
                ? verdict(
                      result,
                      BigInt(
                          (await rpc.send("eth_getBalance", [
                              address,
                              toQuantity(head.number)
                          ])) as string
                      )
                  )
                : "unchecked"
    );
    shadow<[string], bigint>(
        "eth_getTransactionCount",
        "getTransactionCount",
        async (rpc, [address], result, head) =>
            head
                ? verdict(
                      result,
                      BigInt(
                          (await rpc.send("eth_getTransactionCount", [
                              address,
                              toQuantity(head.number)
                          ])) as string
                      )
                  )
                : "unchecked"
    );
    shadow<[string], string>(
        "eth_getCode",
        "getCode",
        async (rpc, [address], result, head) =>
            head
                ? verdict(
                      result,
                      (
                          (await rpc.send("eth_getCode", [
                              address,
                              toQuantity(head.number)
                          ])) as string
                      ).toLowerCase()
                  )
                : "unchecked"
    );
    shadow<[string, boolean], unknown>(
        "eth_getBlock",
        "getBlock",
        async (rpc, [selector, full], result) => {
            // a latest the node has moved past is compared as the block it was
            const hash = (result as { hash: string }).hash;
            const [method, param] =
                selector === "latest"
                    ? ["eth_getBlockByHash", hash]
                    : [
                          selector.length === 66
                              ? "eth_getBlockByHash"
                              : "eth_getBlockByNumber",
                          selector
                      ];
            return verdict(result, await rpc.send(method, [param, full]));
        }
    );
    shadow<[string], unknown>(
        "eth_getTransactionByHash",
        "getTransaction",
        async (rpc, [hash], result) =>
            verdict(result, await rpc.send("eth_getTransactionByHash", [hash]))
    );
    shadow<[string], unknown>(
        "eth_getTransactionReceipt",
        "getTransactionReceipt",
        async (rpc, [hash], result) =>
            verdict(result, await rpc.send("eth_getTransactionReceipt", [hash]))
    );

    // blockNumber: the node's number before the call is the floor of a fresh answer
    const blockNumber = Mirror.prototype.blockNumber;
    Mirror.prototype.blockNumber = async function (this: Mirror) {
        let floor: bigint | undefined;
        try {
            floor = BigInt(await node!.send("eth_blockNumber", []));
        } catch {
            floor = undefined;
        }
        let result: bigint;
        try {
            result = await blockNumber.call(this);
        } catch (error) {
            if (error instanceof MirrorUnavailableError)
                countsOf("eth_blockNumber").declined++;
            throw error;
        }
        if (floor === undefined) record("eth_blockNumber", "unchecked");
        else {
            if (result < floor) countsOf("eth_blockNumber").stale++;
            record("eth_blockNumber", SAME);
        }
        return result;
    };

    process.on("exit", flush);
}
