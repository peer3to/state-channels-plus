// @spec-test-coverage-ignore: test-only diagnostic that compares the mirror's local eth_call answers with the node's; it asserts nothing itself
import {
    Mirror,
    type MirrorCall,
    type MirrorCallOutcome
} from "@/evm/p2pRuntime/rpcNodes/mirror/Mirror";
import {
    MirrorChain,
    type MirrorHead
} from "@/evm/p2pRuntime/rpcNodes/mirror/MirrorChain";
import { JsonRpcProvider, toQuantity } from "ethers";
import { AsyncLocalStorage } from "node:async_hooks";
import { appendFileSync } from "node:fs";

/** One mirror answer the node disagreed with. */
type ShadowMismatch = {
    method: "eth_call";
    to: string;
    calldataPrefix: string;
    block: string;
    mirror: string;
    node: string;
};

type ShadowStore = { head?: MirrorHead };

/** The answer as bytes the two sides can be compared on. */
function describeOutcome(outcome: MirrorCallOutcome): string {
    if (outcome.kind === "return") return `return ${outcome.data}`;
    if (outcome.kind === "revert") return `revert ${outcome.data}`;
    return `failure ${outcome.message}`;
}

/** What the node answers `request` with at block `number`, in the same terms. */
async function nodeOutcome(
    node: JsonRpcProvider,
    request: MirrorCall,
    number: bigint
): Promise<string> {
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
        const data = error as {
            data?: unknown;
            info?: { error?: { data?: unknown } };
        };
        const revertData = data.data ?? data.info?.error?.data;
        return typeof revertData === "string" && revertData.startsWith("0x")
            ? `revert ${revertData}`
            : `failure ${String((error as Error).message).slice(0, 160)}`;
    }
}

let installed = false;
let node: JsonRpcProvider | undefined;

/**
 * Shadow-checks every `eth_call` the mirror answers locally in this process:
 * the same call goes to the node at the block the mirror answered at, and the
 * result bytes (revert data included) are compared. Matches and mismatches are
 * counted; each mismatch is appended to `logPath` as a JSON line, and a summary
 * line is appended when the process exits. The shadow calls are extra load:
 * counts of requests are taken without it. Patches the prototypes, so it
 * covers every inline runtime of the process and none in a worker thread.
 */
export function installMirrorShadowCheck(
    nodeUrl: string,
    logPath: string
): void {
    // each harness may run its own node: the checks go to the latest one
    node?.destroy();
    node = new JsonRpcProvider(nodeUrl, undefined, { staticNetwork: true });
    if (installed) return;
    installed = true;
    const store = new AsyncLocalStorage<ShadowStore>();
    const counts = { matches: 0, mismatches: 0, unchecked: 0 };

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

    const call = Mirror.prototype.call;
    Mirror.prototype.call = function (
        this: Mirror,
        request: MirrorCall
    ): Promise<MirrorCallOutcome> {
        const shadow: ShadowStore = {};
        return store.run(shadow, async () => {
            const outcome = await call.call(this, request);
            const head = shadow.head;
            if (!head) {
                counts.unchecked++;
                return outcome;
            }
            const mirrorSays = describeOutcome(outcome);
            const nodeSays = await nodeOutcome(node!, request, head.number);
            if (mirrorSays === nodeSays) counts.matches++;
            else {
                counts.mismatches++;
                const mismatch: ShadowMismatch = {
                    method: "eth_call",
                    to: request.to,
                    calldataPrefix: request.data.slice(0, 10),
                    block: `${head.number} ${head.hash}`,
                    mirror: mirrorSays.slice(0, 200),
                    node: nodeSays.slice(0, 200)
                };
                appendFileSync(logPath, JSON.stringify(mismatch) + "\n");
            }
            return outcome;
        });
    };

    process.on("exit", () =>
        appendFileSync(logPath, JSON.stringify({ summary: counts }) + "\n")
    );
}
