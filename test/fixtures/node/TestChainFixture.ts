// @spec-test-coverage-ignore: test-chain staging; executable evidence belongs to its calling test declarations
import { jsonRpc } from "@test/utils/nodeInfra";
import { repoRoot } from "@test/utils/repoRoot";
import { expect } from "chai";
import { spawn } from "child_process";
import { once } from "node:events";
import path from "path";

export const LAUNCHER = "scripts/infra/start-hardhat-node.js";
export const DIFF_TRACE = {
    tracer: "prestateTracer",
    tracerConfig: { diffMode: true }
};

export type Receipt = {
    blockNumber: string;
    status: string;
    contractAddress: string;
};
export type Block = { gasLimit: string };
// prestateTracer diffMode: address → the account fields the transaction changed
export type AccountDiff = Record<string, { balance?: string }>;
export type StateDiff = { pre: AccountDiff; post: AccountDiff };
export type Transfer = {
    hash: string;
    receipt: Receipt;
    recipient: string;
    before: bigint;
    after: bigint;
};

export const call =
    (url: string) =>
    <T>(method: string, params: unknown[] = []) =>
        jsonRpc(url, method, params) as Promise<T>;
export type Rpc = ReturnType<typeof call>;

export async function receiptOf(rpc: Rpc, hash: string): Promise<Receipt> {
    for (let attempt = 0; attempt < 200; attempt++) {
        const receipt = await rpc<Receipt | null>("eth_getTransactionReceipt", [
            hash
        ]);
        if (receipt) return receipt;
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`no receipt for ${hash}`);
}

/** Sends one wei from account 0 to account 1 and reads the real balances around it. */
export async function transferOneWei(rpc: Rpc): Promise<Transfer> {
    const [sender, recipient] = await rpc<string[]>("eth_accounts");
    const balance = async () =>
        BigInt(await rpc<string>("eth_getBalance", [recipient, "latest"]));
    const before = await balance();
    const hash = await rpc<string>("eth_sendTransaction", [
        { from: sender, to: recipient, value: "0x1", gas: "0x5208" }
    ]);
    const receipt = await receiptOf(rpc, hash);
    return { hash, receipt, recipient, before, after: await balance() };
}

export function expectRecipientDiff(diff: StateDiff, transfer: Transfer) {
    const at = (side: AccountDiff) =>
        Object.entries(side).find(
            ([address]) =>
                address.toLowerCase() === transfer.recipient.toLowerCase()
        )?.[1];
    expect(BigInt(at(diff.pre)!.balance!)).to.equal(transfer.before);
    expect(BigInt(at(diff.post)!.balance!)).to.equal(transfer.after);
    expect(transfer.after - transfer.before).to.equal(1n);
}

/** Both state-diff trace RPCs must report the transfer's real pre/post state. */
export async function expectBothTraces(rpc: Rpc, transfer: Transfer) {
    expectRecipientDiff(
        await rpc<StateDiff>("debug_traceTransaction", [
            transfer.hash,
            DIFF_TRACE
        ]),
        transfer
    );
    const block = await rpc<{ txHash: string; result: StateDiff }[]>(
        "debug_traceBlockByNumber",
        [transfer.receipt.blockNumber, DIFF_TRACE]
    );
    const traced = block.find((entry) => entry.txHash === transfer.hash);
    expectRecipientDiff(traced!.result, transfer);
}

export async function expectStopped(url: string) {
    let refusal: Error | undefined;
    try {
        await call(url)("eth_chainId");
    } catch (error) {
        refusal = error as Error;
    }
    expect(refusal).to.be.instanceOf(Error);
}

/** Waits until nothing answers at `url`: its chain process is gone. */
export async function expectStoppedSoon(url: string) {
    for (let attempt = 0; attempt < 100; attempt++) {
        try {
            await call(url)("eth_chainId");
        } catch {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`${url} still answers`);
}

/** Runs the launcher as `yarn infra:hardhat-node` does and waits for its bound-port line. */
export async function launchStandalone(env: NodeJS.ProcessEnv) {
    const child = spawn(process.execPath, [path.join(repoRoot(), LAUNCHER)], {
        cwd: repoRoot(),
        env: {
            ...process.env,
            E2E_INTERVAL_MINING: undefined,
            HARDHAT_CHAIN_ID: undefined,
            HARDHAT_NODE_HOST: "127.0.0.1",
            HARDHAT_NODE_PORT: "0",
            ...env
        },
        stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    const url = await new Promise<string>((resolve, reject) => {
        const onData = (chunk: Buffer) => {
            output += chunk.toString();
            const bound = /Listening on 127\.0\.0\.1:(\d+)\r?\n/.exec(output);
            if (bound) resolve(`http://127.0.0.1:${bound[1]}`);
        };
        child.stdout.on("data", onData);
        child.stderr.on("data", onData);
        child.once("error", reject);
        child.once("exit", (code) =>
            reject(new Error(`launcher exited with ${code}:\n${output}`))
        );
    });
    const stop = async () => {
        if (child.exitCode !== null || child.signalCode !== null) return;
        const exited = once(child, "exit");
        child.kill("SIGTERM");
        await exited;
    };
    return { url, rpc: call(url), stop, child };
}
