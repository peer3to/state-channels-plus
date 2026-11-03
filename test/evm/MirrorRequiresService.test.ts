import { NewBlockHeadersNode } from "../fixtures/node/NewBlockHeadersNode";
import MirrorRpcProvider from "@/evm/p2pRuntime/rpcNodes/MirrorRpcProvider";
import RpcNodeProvider from "@/evm/p2pRuntime/rpcNodes/RpcNodeProvider";
import { createRuntimeChainContext } from "@/evm/p2pRuntime/RuntimeChainContext";
import { config } from "@/utils/config";
import { createLogger } from "@/utils/logging";
import { rejectionOf } from "@test/fixtures/node/StorageDiffSession";
import { expect } from "chai";

const MISSING_SERVICE = "STORAGE_DIFF_URL is required";
/** How long a request that only a node answers may stay unanswered. */
const UNANSWERED_AFTER_MS = 10_000;

describe("Storage diff service requirement", function () {
    it("refuses to build the mirror provider without a storage diff URL", async function () {
        const node = await NewBlockHeadersNode.start();
        const logger = createLogger(
            {},
            {},
            { level: "error", attachErrorListener: false }
        );
        const rpcNode = new RpcNodeProvider(node.url, logger);
        try {
            expect(
                () =>
                    new MirrorRpcProvider([rpcNode], logger, {
                        storageDiffUrl: ""
                    })
            ).to.throw(MISSING_SERVICE);
        } finally {
            rpcNode.destroy();
            await node.close();
            logger.dispose();
        }
    });

    it("refuses to start the runtime chain context without a storage diff URL before any node is asked", async function () {
        const logger = createLogger(
            {},
            {},
            { level: "error", attachErrorListener: false }
        );
        try {
            const failure = await rejectionOf(
                createRuntimeChainContext(
                    {
                        ...config,
                        PROVIDER_URL: "ws://127.0.0.1:1",
                        STORAGE_DIFF_URL: ""
                    },
                    "test test test test test test test test test test test junk",
                    logger
                )
            );

            expect(failure).to.be.instanceOf(Error);
            // not the unreachable node's refusal: no node was opened
            expect((failure as Error).message).to.include(MISSING_SERVICE);
        } finally {
            logger.dispose();
        }
    });
});
