/**
 * Capacity peers on this host for a driver on another machine
 * (`BENCH_PEER_HOSTS` in lightClientCapacity.ts). Starts `threads` peer
 * threads against `nodeUrl`, reads `{ id, thread, message }` lines on its
 * standard input, hands each message to its thread and writes the answer as
 * `@@peer { id, answer }`. Stops every thread and exits when its input ends.
 *
 *   ts-node scripts/bench/capacityPeerHost.ts <nodeUrl> <threads>
 */
import { createInterface } from "node:readline";
import { PEER_HOST_LINE, PeerWorker } from "./peerThreads";

const [nodeUrl, threadCount] = process.argv.slice(2);
const threads = Array.from(
    { length: Number(threadCount) },
    () => new PeerWorker(nodeUrl)
);

createInterface({ input: process.stdin })
    .on("line", (line) => {
        const { id, thread, message } = JSON.parse(line) as {
            id: number;
            thread: number;
            message: unknown;
        };
        void threads[thread].ask(message).then((answer) => {
            process.stdout.write(
                PEER_HOST_LINE + JSON.stringify({ id, answer }) + "\n"
            );
        });
    })
    .on("close", () => {
        void Promise.all(threads.map((thread) => thread.close())).then(() =>
            process.exit(0)
        );
    });
