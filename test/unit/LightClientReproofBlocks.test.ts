import { createRpcNodesProvider } from "@/index";
import { recordingLogger } from "@test/fixtures/node/RpcNodesFixture";
import { expect } from "chai";

/** A local port nothing listens on. */
const UNREACHABLE_ENDPOINT = "ws://127.0.0.1:9";
const INVALID_INTERVAL =
    "LIGHT_CLIENT_REPROOF_BLOCKS must be a positive integer";
const UNREACHABLE = "Chain access requires a reachable WebSocket provider";

/** What building the light client provider with `reproofBlocks` fails with. */
async function startupFailure(reproofBlocks: number): Promise<string> {
    const { logger } = recordingLogger("error");
    try {
        const provider = await createRpcNodesProvider(
            {
                PROVIDER_URL: UNREACHABLE_ENDPOINT,
                LIGHT_CLIENT: true,
                LIGHT_CLIENT_REPROOF_BLOCKS: reproofBlocks
            },
            logger
        );
        provider.destroy();
        throw new Error("Expected the provider not to start");
    } catch (error) {
        return String(error);
    } finally {
        logger.dispose();
    }
}

describe("Light client re-proof interval", function () {
    it("rejects an interval of zero blocks before any endpoint is tried", async function () {
        expect(await startupFailure(0)).to.include(
            `${INVALID_INTERVAL}, got 0`
        );
    });

    it("rejects an interval that is not a whole number of blocks", async function () {
        expect(await startupFailure(2.5)).to.include(
            `${INVALID_INTERVAL}, got 2.5`
        );
    });

    it("accepts an interval of one block and goes on to the endpoint", async function () {
        expect(await startupFailure(1)).to.include(UNREACHABLE);
    });
});
