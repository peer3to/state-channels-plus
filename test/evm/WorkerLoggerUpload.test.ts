import { expect } from "chai";
import http from "node:http";
import { AddressInfo } from "node:net";

import { createContractExecutorFactory } from "@/evm";
import WorkerContractExecutor from "@/evm/contractExecutor/WorkerContractExecutor";
import { createLogger } from "@/utils";
import { decodeLogs, decompressFromBase64 } from "@/utils/logging/logEncoder";

describe("worker logger upload", function () {
    this.timeout(15000); // worker spawn + axios jitter (0-3s) + retry

    const CHANNEL_ID =
        "0x2222222222222222222222222222222222222222222222222222222222222222";

    it("tags worker uploads with threadName 'evm' and the pushed channelId", async () => {
        const received: Array<Record<string, unknown>> = [];
        const server = http.createServer((req, res) => {
            let body = "";
            req.on("data", (c) => (body += c));
            req.on("end", () => {
                try {
                    received.push(JSON.parse(body));
                } catch {
                    received.push({ unparseable: body });
                }
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end("{}");
            });
        });
        await new Promise<void>((r) => server.listen(0, r));
        const port = (server.address() as AddressInfo).port;
        const endpoint = `http://127.0.0.1:${port}/logs/upload`;

        // Factory derives the worker's "evm" recipe from this logger. This
        // logger's own threadName ("sdk") must NOT clobber the worker's "evm"
        // when context is later forwarded.
        const logger = createLogger(
            {
                peerAddress:
                    "0x1111111111111111111111111111111111111111" as any,
                threadName: "sdk"
            },
            { component: "Test" },
            {
                logUploaderConfig: { uploadEndpoint: endpoint, apiToken: "" },
                level: "info"
            }
        );

        const executor = (await createContractExecutorFactory({
            dedicatedThread: true,
            customPrecompiles: [],
            logger
        })) as WorkerContractExecutor;
        logger.setRemoteSibling(executor);

        // channelId is unknown at worker spawn; it arrives later via a child
        // logger (mirrors StateManager.setChannelId) and must reach the worker.
        logger
            .child({ component: "StateManager" })
            .updateSharedContext({ channelId: CHANNEL_ID });

        try {
            await executor.uploadLogs();

            // Detached upload has up to 3s jitter before it reaches the server.
            const deadline = Date.now() + 10000;
            while (received.length === 0 && Date.now() < deadline) {
                await new Promise((r) => setTimeout(r, 100));
            }

            expect(received.length).to.be.greaterThan(0);
            expect(received[0].threadName).to.equal("evm");
            expect(received[0].peerAddress).to.equal(
                "0x1111111111111111111111111111111111111111"
            );
            expect(received[0].channelId).to.equal(CHANNEL_ID);

            // The envelope must carry real worker logs, not []. The flush itself
            // records a "worker report-bug flush" line, so it's always present.
            const entries = decodeLogs(
                decompressFromBase64(received[0].compressedLogs as string)
            );
            expect(entries.length).to.be.greaterThan(0);
            expect(
                entries.some((e) =>
                    e.message.includes("worker report-bug flush")
                )
            ).to.equal(true);
        } finally {
            await executor.dispose();
            await new Promise<void>((r) => server.close(() => r()));
        }
    });
});
