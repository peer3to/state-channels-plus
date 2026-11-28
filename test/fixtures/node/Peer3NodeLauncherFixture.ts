// @spec-test-coverage-ignore: stand-in binaries for the peer3 node launcher's self-tests; executable evidence belongs to its calling test declarations
import {
    jsonRpc,
    PEER3_NODE_PID_FILE,
    PEER3_NODES_DIR,
    startHardhatNode,
    startPeer3Node
} from "@test/utils/nodeInfra";
import { waitFor } from "@test/utils/waitFor";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";

/**
 * A directory under the checkout's `temp`, removed when the test process
 * exits. A worker's system temp dir can forbid running files from it.
 */
function testDir(prefix: string): string {
    const parent = path.join(path.dirname(PEER3_NODES_DIR), "peer3-launcher");
    fs.mkdirSync(parent, { recursive: true });
    const dir = fs.mkdtempSync(path.join(parent, prefix));
    process.once("exit", () =>
        fs.rmSync(dir, { recursive: true, force: true })
    );
    return dir;
}

/** A nodes directory of this test alone, for `startPeer3Node`'s `nodesDir`. */
export function freshNodesDir(): string {
    return testDir("nodes-");
}

/** The node database directories in `nodesDir`. */
export function nodeDirsIn(nodesDir: string): string[] {
    return fs.readdirSync(nodesDir).sort();
}

/**
 * An executable shell script that stands in for the node binary: it writes
 * its arguments one per line next to itself, prints `stderrLine` to stderr
 * and exits with `code`.
 */
export function failingNodeBinary(stderrLine: string, code: number): string {
    const binary = path.join(testDir("bin-"), "zero-fee-node");
    fs.writeFileSync(
        binary,
        `#!/bin/sh\nprintf '%s\\n' "$@" > "$0.args"\n` +
            `echo ${JSON.stringify(stderrLine)} >&2\nexit ${code}\n`,
        { mode: 0o755 }
    );
    return binary;
}

/**
 * An executable shell script that stands in for the node binary and never gets
 * ready: it writes its arguments one per line next to itself and sleeps.
 */
export function idleNodeBinary(): string {
    const binary = path.join(testDir("bin-"), "zero-fee-node");
    fs.writeFileSync(
        binary,
        `#!/bin/sh\nprintf '%s\\n' "$@" > "$0.args"\nexec sleep 60\n`,
        { mode: 0o755 }
    );
    return binary;
}

/**
 * An executable Node script that stands in for a node that gets ready: it
 * listens on the `--rpc-port` it is given (0: one the system picks), prints
 * the line the launcher reads the bound port from, and answers every JSON-RPC
 * request, `eth_chainId` with 0x1.
 */
export function servingNodeBinary(): string {
    const binary = path.join(testDir("bin-"), "zero-fee-node");
    const script = `
const http = require("node:http");
const args = process.argv.slice(2);
const port = Number(args[args.indexOf("--rpc-port") + 1]);
const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
        const { id, method } = JSON.parse(body || "{}");
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ jsonrpc: "2.0", id, result: method === "eth_chainId" ? "0x1" : "0x0" }));
    });
});
server.listen(port, "127.0.0.1", () =>
    console.log(\`Running JSON-RPC server: addr=127.0.0.1:\${server.address().port}\`)
);
process.on("SIGTERM", () => process.exit(0));
`;
    fs.writeFileSync(binary, `#!${process.execPath}\n${script}`, {
        mode: 0o755
    });
    return binary;
}

/** The value the launcher gave the stand-in `binary` for `flag`. */
export function argumentGivenTo(binary: string, flag: string): string {
    const args = fs.readFileSync(`${binary}.args`, "utf8").split("\n");
    return args[args.indexOf(flag) + 1];
}

/** The `--base-path` the launcher gave the stand-in `binary`. */
export function basePathGivenTo(binary: string): string {
    return argumentGivenTo(binary, "--base-path");
}

/**
 * What starting a peer3 node with its database in `nodesDir` failed with; a
 * node that starts is stopped.
 */
export async function peer3NodeStartFailure(
    nodesDir: string
): Promise<unknown> {
    try {
        const node = await startPeer3Node({ nodesDir });
        node.stop();
    } catch (error) {
        return error;
    }
    return undefined;
}

/** Runs `use` with `PEER3_NODE_BIN` set to `binary`, or unset when undefined. */
export async function withPeer3NodeBin<T>(
    binary: string | undefined,
    use: () => Promise<T>
): Promise<T> {
    const before = process.env.PEER3_NODE_BIN;
    if (binary === undefined) delete process.env.PEER3_NODE_BIN;
    else process.env.PEER3_NODE_BIN = binary;
    try {
        return await use();
    } finally {
        if (before === undefined) delete process.env.PEER3_NODE_BIN;
        else process.env.PEER3_NODE_BIN = before;
    }
}

/** A process id that no running process has: one of a process that exited. */
export async function exitedProcessId(): Promise<number> {
    const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
    await once(child, "exit");
    return child.pid!;
}

/**
 * A node database directory in `nodesDir` as the launcher leaves it: its
 * process id file holds `pid`, is empty when `pid` is "", or is missing when
 * `pid` is undefined.
 */
export function nodeDirWithPid(
    nodesDir: string,
    pid: number | "" | undefined
): string {
    const dir = fs.mkdtempSync(path.join(nodesDir, "node-"));
    if (pid !== undefined)
        fs.writeFileSync(path.join(dir, PEER3_NODE_PID_FILE), String(pid));
    return path.basename(dir);
}

/**
 * Runs `use` with `PEER3_NODE_BIN` unset and `binary`'s directory first on
 * PATH, so the launcher finds `zero-fee-node` there.
 */
export async function withNodeOnPath<T>(
    binary: string,
    use: () => Promise<T>
): Promise<T> {
    const path_ = process.env.PATH;
    process.env.PATH = `${path.dirname(binary)}${path.delimiter}${path_ ?? ""}`;
    try {
        return await withPeer3NodeBin(undefined, use);
    } finally {
        process.env.PATH = path_;
    }
}

/**
 * Starts two peer3 nodes at once without a port and returns the URLs they
 * answered on, each with its chain id; both are stopped. The node is the
 * binary `PEER3_NODE_BIN` names.
 */
export async function twoNodesStartedAtOnce(
    nodesDir: string
): Promise<{ url: string; chainId: unknown }[]> {
    const started = await Promise.allSettled([
        startPeer3Node({ nodesDir }),
        startPeer3Node({ nodesDir })
    ]);
    const nodes = started.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : []
    );
    try {
        const failed = started.find((result) => result.status === "rejected");
        if (failed) throw (failed as PromiseRejectedResult).reason;
        return await Promise.all(
            nodes.map(async ({ url }) => ({
                url,
                chainId: await jsonRpc(url, "eth_chainId")
            }))
        );
    } finally {
        for (const node of nodes) {
            node.stop();
            await node.exited;
        }
    }
}

/**
 * Starts a `--parachain` slot node from the stand-in `binary`, which never gets
 * ready, and reports its database directory while it runs and after it is
 * killed: whether the directory names the node's live process, and whether it
 * is gone once the process died.
 */
export async function slotNodeDirectory(
    binary: string
): Promise<{ namesLiveProcess: boolean; removedAfterKill: boolean }> {
    const parachain = process.env.PARACHAIN;
    process.env.PARACHAIN = "1";
    try {
        return await withPeer3NodeBin(binary, async () => {
            const starting = startHardhatNode().catch(() => undefined);
            await waitFor(() => fs.existsSync(`${binary}.args`));
            const basePath = basePathGivenTo(binary);
            const pidFile = path.join(basePath, PEER3_NODE_PID_FILE);
            await waitFor(() => fs.existsSync(pidFile));
            const pid = Number(fs.readFileSync(pidFile, "utf8"));
            const namesLiveProcess = isAlive(pid);
            process.kill(pid, "SIGKILL");
            await starting;
            return {
                namesLiveProcess,
                removedAfterKill: !fs.existsSync(basePath)
            };
        });
    } finally {
        if (parachain === undefined) delete process.env.PARACHAIN;
        else process.env.PARACHAIN = parachain;
    }
}

function isAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}
