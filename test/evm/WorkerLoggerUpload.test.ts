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

        // Factory derives the worker's "evm" recipe from this logger; its own
        // threadName ("sdk") must NOT clobber the worker's "evm".
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
        executor.attachLogger(logger);

        // channelId is unknown at worker spawn; it arrives later via a child
        // logger (mirrors StateManager.setChannelId) and must reach the worker.
        logger
            .child({ component: "StateManager" })
            .updateSharedContext({ channelId: CHANNEL_ID });

        try {
            // Force a worker-side log (deploy INVALID opcode 0xfe → warn) so the
            // flush proves the worker's OWN store crosses the gossip edge.
            await executor.deploy("0xfe").catch(() => {});

            await logger.uploadLogs("report-bug flush");

            // The main-thread trigger flushes BOTH threads; uploads arrive in any order.
            const deadline = Date.now() + 10000;
            const findEvm = () => received.find((r) => r.threadName === "evm");
            while (!findEvm() && Date.now() < deadline) {
                await new Promise((r) => setTimeout(r, 100));
            }

            const workerUpload = findEvm();
            expect(workerUpload, "worker (evm) upload not received").to.not.be
                .undefined;
            expect(workerUpload!.peerAddress).to.equal(
                "0x1111111111111111111111111111111111111111"
            );
            expect(workerUpload!.channelId).to.equal(CHANNEL_ID);
            const entries = decodeLogs(
                decompressFromBase64(workerUpload!.compressedLogs as string)
            );
            expect(entries).to.be.an("array");
            expect(
                entries.length,
                "worker's own log store should cross the gossip edge"
            ).to.be.greaterThan(0);
        } finally {
            await executor.dispose();
            await new Promise<void>((r) => server.close(() => r()));
        }
    });
});
