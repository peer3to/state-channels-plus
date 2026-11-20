// @spec-test-coverage-ignore: stand-in binaries for the peer3 node launcher's self-tests; executable evidence belongs to its calling test declarations
import {
    PEER3_NODE_PID_FILE,
    PEER3_NODES_DIR,
    startPeer3Node
} from "@test/utils/nodeInfra";
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

/** The `--base-path` the launcher gave the stand-in `binary`. */
export function basePathGivenTo(binary: string): string {
    const args = fs.readFileSync(`${binary}.args`, "utf8").split("\n");
    return args[args.indexOf("--base-path") + 1];
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
