// @spec-test-coverage-ignore: stand-in binaries for the peer3 node launcher's self-tests; executable evidence belongs to its calling test declarations
import { startPeer3Node } from "@test/utils/nodeInfra";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";

/** Where the launcher keeps each peer3 node's database directory. */
export const PEER3_NODES_DIR = path.join(process.cwd(), "temp", "peer3-nodes");
/** The file in a node's database directory that names its process. */
const PEER3_NODE_PID_FILE = "node.pid";

/** The node database directories that exist now. */
export function peer3NodeDirs(): Set<string> {
    if (!fs.existsSync(PEER3_NODES_DIR)) return new Set();
    return new Set(fs.readdirSync(PEER3_NODES_DIR));
}

/**
 * An executable shell script that stands in for the node binary: it prints
 * `stderrLine` to stderr and exits with `code`.
 */
export function failingNodeBinary(stderrLine: string, code: number): string {
    // a worker's system temp dir can forbid running files from it
    const binDir = path.join(process.cwd(), "temp", "peer3-node-bins");
    fs.mkdirSync(binDir, { recursive: true });
    const dir = fs.mkdtempSync(path.join(binDir, "bin-"));
    process.once("exit", () =>
        fs.rmSync(dir, { recursive: true, force: true })
    );
    const binary = path.join(dir, "zero-fee-node");
    fs.writeFileSync(
        binary,
        `#!/bin/sh\necho ${JSON.stringify(stderrLine)} >&2\nexit ${code}\n`,
        { mode: 0o755 }
    );
    return binary;
}

/** What starting a peer3 node failed with; a node that starts is stopped. */
export async function peer3NodeStartFailure(): Promise<unknown> {
    try {
        const node = await startPeer3Node();
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

/** A node database directory as the launcher leaves it, naming process `pid`. */
export function nodeDirOfProcess(pid: number): string {
    fs.mkdirSync(PEER3_NODES_DIR, { recursive: true });
    const dir = fs.mkdtempSync(path.join(PEER3_NODES_DIR, "node-"));
    fs.writeFileSync(path.join(dir, PEER3_NODE_PID_FILE), String(pid));
    return path.basename(dir);
}

/** Removes a node database directory a test made. */
export function removeNodeDir(name: string): void {
    fs.rmSync(path.join(PEER3_NODES_DIR, name), {
        recursive: true,
        force: true
    });
}
