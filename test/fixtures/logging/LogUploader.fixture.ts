import http from "http";
import { AddressInfo } from "net";
import { ethers } from "ethers";
import { LogStore } from "@/utils/logging/logStore";
import { NodeLogUploader } from "@/utils/logging/node/NodeLogUploader";
import { NodeLogger } from "@/utils/logging/node/NodeLogger";
import { decodeLogs, decompressFromBase64 } from "@/utils/logging/logEncoder";
import {
    LogEntry,
    type LogThreadName,
    type SharedLoggerContext
} from "@/utils/logging/Logger";

export type ReceivedUpload = {
    channelId: string;
    peerAddress: string;
    threadName: LogThreadName;
    compressedLogs: string;
    fromSeq: number;
    toSeq: number;
};

export type LogReceiverOptions = {
    // status per upload, by arrival order. awaited -> a test can hold a response
    // open while driving the next one. defaults to 200.
    respond?: (
        received: ReceivedUpload,
        index: number
    ) => number | Promise<number>;
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
export async function startLogReceiver(
    options: LogReceiverOptions = {}
): Promise<LogReceiver> {
    const requests: ReceivedUpload[] = [];
    const waiters: Array<{ count: number; resolve: () => void }> = [];

    const server = http.createServer((req, res) => {
        let body = "";
        req.setEncoding("utf8");
        req.on("data", (chunk) => {
            body += chunk;
        });
        req.on("end", () => {
            let received: ReceivedUpload | undefined;
            try {
                received = JSON.parse(body) as ReceivedUpload;
                requests.push(received);
            } catch {
                // ignore non-JSON probes
            }
            const index = requests.length - 1;
            // resolve on arrival, before the response is decided -> a test can see
            // a request whose response is held open
            for (let i = waiters.length - 1; i >= 0; i--) {
                if (requests.length >= waiters[i].count) {
                    waiters[i].resolve();
                    waiters.splice(i, 1);
                }
            }
            void Promise.resolve(
                received && options.respond
                    ? options.respond(received, index)
                    : 200
            ).then((status) => {
                res.setHeader("x-upload-id", "test-receiver");
                res.statusCode = status;
                res.end(JSON.stringify({ ok: status < 400 }));
            });
        });
    });

    await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve)
    );
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

export {
    crashLogConfigOverrides,
    crashLogUploadOverrides
} from "./crashLogConfig";

/** uploads for one peer, grouped by sending thread */
export function streamsFor(
    receiver: LogReceiver,
    peerAddress: string
): Map<LogThreadName, ReceivedUpload[]> {
    return streamsIn(receiver.requests, peerAddress);
}

/** every upload one realm sent, across peers - for single-peer scenarios */
export function threadStream(
    receiver: LogReceiver,
    threadName: LogThreadName
): ReceivedUpload[] {
    return receiver.requests.filter(
        (request) => request.threadName === threadName
    );
}

/** the same grouping over an already-sliced set, e.g. one round's uploads */
export function streamsIn(
    uploads: readonly ReceivedUpload[],
    peerAddress: string
): Map<LogThreadName, ReceivedUpload[]> {
    const streams = new Map<LogThreadName, ReceivedUpload[]>();
    for (const upload of uploads) {
        if (upload.peerAddress !== peerAddress) continue;
        const existing = streams.get(upload.threadName) ?? [];
        existing.push(upload);
        streams.set(upload.threadName, existing);
    }
    return streams;
}

/** every message the given uploads carry, in arrival order */
export function messagesIn(uploads: ReceivedUpload[]): string[] {
    return uploads.flatMap((upload) =>
        decodeUpload(upload).map((entry) => entry.message)
    );
}

/** whether `text` appears anywhere in the uploads - message, metadata or stack.
 *  a captured crash carries its error in metadata, not the message. */
export function uploadsInclude(
    uploads: ReceivedUpload[],
    text: string
): boolean {
    return uploads.some((upload) =>
        JSON.stringify(decodeUpload(upload)).includes(text)
    );
}

export type UploaderFixture = {
    logUploader: NodeLogUploader;
    logStore: LogStore;
    logger: NodeLogger;
};

// Builds a real uploader + logger against a real endpoint, wired exactly as the
// platform loggers do (`logUploader.setLogger(this)` in the logger constructor).
// jitter off by default so tests do not sleep
export function createUploaderFixture(opts: {
    uploadEndpoint: string;
    jitterMaxMs?: number;
    // replaces the default channel/peer identity, e.g. a thread name and no channel
    sharedContext?: SharedLoggerContext;
    maxStoreBytes?: number;
}): UploaderFixture {
    const logStore = new LogStore(opts.maxStoreBytes ?? 1024 * 1024, true);
    const sharedContext: SharedLoggerContext = opts.sharedContext ?? {
        channelId: ethers.ZeroHash,
        peerAddress: ethers.Wallet.createRandom().address
    };
    const logUploader = new NodeLogUploader(
        logStore,
        {
            uploadEndpoint: opts.uploadEndpoint,
            jitterMaxMs: opts.jitterMaxMs ?? 0
        },
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
