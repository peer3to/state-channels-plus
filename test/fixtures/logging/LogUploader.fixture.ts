import http from "http";
import { AddressInfo } from "net";
import { ethers } from "ethers";
import { LogStore } from "@/utils/logging/logStore";
import { NodeLogUploader } from "@/utils/logging/node/NodeLogUploader";
import { NodeLogger } from "@/utils/logging/node/NodeLogger";
import { decodeLogs, decompressFromBase64 } from "@/utils/logging/logEncoder";
import { LogEntry } from "@/utils/logging/Logger";

export type ReceivedUpload = {
    channelId: string;
    peerAddress: string;
    compressedLogs: string;
};

export type LogReceiver = {
    url: string;
    requests: ReceivedUpload[];
    // Resolves once `count` uploads have been received (event-driven, resolved by
    // the request handler) - so tests assert what was actually delivered.
    waitForRequests: (count: number, timeoutMs?: number) => Promise<void>;
    close: () => Promise<void>;
};

// A real local HTTP endpoint that captures the uploader's POSTed payloads, so
// tests exercise the actual upload boundary instead of stubbing the HTTP client.
export async function startLogReceiver(): Promise<LogReceiver> {
    const requests: ReceivedUpload[] = [];
    const waiters: Array<{ count: number; resolve: () => void }> = [];

    const server = http.createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on("data", (chunk) => chunks.push(chunk as Buffer));
        req.on("end", () => {
            try {
                requests.push(
                    JSON.parse(Buffer.concat(chunks).toString("utf8"))
                );
            } catch {
                // ignore non-JSON probes
            }
            for (let i = waiters.length - 1; i >= 0; i--) {
                if (requests.length >= waiters[i].count) {
                    waiters[i].resolve();
                    waiters.splice(i, 1);
                }
            }
            res.setHeader("x-upload-id", "test-receiver");
            res.statusCode = 200;
            res.end(JSON.stringify({ ok: true }));
        });
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;

    return {
        url: `http://127.0.0.1:${port}/logs`,
        requests,
        waitForRequests: (count, timeoutMs = 2000) =>
            new Promise<void>((resolve, reject) => {
                if (requests.length >= count) return resolve();
                const timer = setTimeout(
                    () =>
                        reject(
                            new Error(
                                `timed out waiting for ${count} uploads (got ${requests.length})`
                            )
                        ),
                    timeoutMs
                );
                waiters.push({
                    count,
                    resolve: () => {
                        clearTimeout(timer);
                        resolve();
                    }
                });
            }),
        close: () =>
            new Promise<void>((resolve, reject) =>
                server.close((err) => (err ? reject(err) : resolve()))
            )
    };
}

export function decodeUpload(received: ReceivedUpload): LogEntry[] {
    return decodeLogs(decompressFromBase64(received.compressedLogs));
}

export type UploaderFixture = {
    logUploader: NodeLogUploader;
    logStore: LogStore;
    logger: NodeLogger;
};

// Builds a real uploader + logger against a real endpoint, wired exactly as the
// platform loggers do (`logUploader.setLogger(this)` in the logger constructor).
// jitterMs is deterministic (default 0) so tests get a fixed delay without
// stubbing Math.random.
export function createUploaderFixture(opts: {
    uploadEndpoint: string;
    jitterMs?: number;
}): UploaderFixture {
    const logStore = new LogStore(1024 * 1024, true);
    const sharedContext = {
        channelId: ethers.ZeroHash,
        peerAddress: ethers.Wallet.createRandom().address
    };
    const logUploader = new NodeLogUploader(
        logStore,
        { uploadEndpoint: opts.uploadEndpoint, jitterMs: opts.jitterMs ?? 0 },
        { component: "LogUploaderTest" },
        sharedContext,
        false
    );
    const logger = new NodeLogger(
        { component: "LogUploaderTest" },
        sharedContext,
        undefined,
        logStore,
        { logUploader },
        new Set(),
        true
    );
    return { logUploader, logStore, logger };
}
