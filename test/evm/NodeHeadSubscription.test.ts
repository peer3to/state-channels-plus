import MultiRpcProvider from "@/evm/p2pRuntime/rpcNodes/MultiRpcProvider";
import RpcNodeProvider from "@/evm/p2pRuntime/rpcNodes/RpcNodeProvider";
import { sleep } from "@/utils";
import { createLogger } from "@/utils/logging";
import {
    NewBlockHeadersNode,
    PUSHED_BLOCK
} from "@test/fixtures/node/NewBlockHeadersNode";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

/** Time is the input: how long a second subscribe that must not come is watched for. */
const ABSENCE_WINDOW_MS = 300;

/**
 * A provider over one node that replays Asset Hub's eth-rpc head
 * subscriptions, or refuses newHeads without offering another kind.
 */
async function withHeadsNode(
    offersNewBlockHeaders: boolean,
    use: (
        node: NewBlockHeadersNode,
        provider: MultiRpcProvider,
        rpcNode: RpcNodeProvider
    ) => Promise<void>
): Promise<void> {
    const node = await NewBlockHeadersNode.start(offersNewBlockHeaders);
    const logger = createLogger(
        {},
        {},
        { level: "error", attachErrorListener: false }
    );
    const rpcNode = new RpcNodeProvider(node.url, logger);
    const provider = new MultiRpcProvider([rpcNode], logger);
    try {
        await rpcNode.firstAttempt;
        await use(node, provider, rpcNode);
    } finally {
        provider.destroy();
        await node.close();
        logger.dispose();
    }
}

describe("Node head subscription", function () {
    it("emits block events from newBlockHeaders on a node that refuses newHeads and offers newBlockHeaders", async function () {
        await withHeadsNode(true, async (node, provider) => {
            const blocks: number[] = [];
            await provider.on("block", (block: number) => blocks.push(block));
            await waitFor(() => node.subscribedSockets === 1);

            node.pushHeader();

            await waitFor(() => blocks.includes(Number(PUSHED_BLOCK)));
            // Mutation: the refusal read from `message` only (the recorded text is in `data`), red
            expect(node.subscribeKinds).to.deep.equal([
                "newHeads",
                "newBlockHeaders"
            ]);
        });
    });

    it("announces the blocks of newBlockHeaders pushes to the node's announcement watchers", async function () {
        await withHeadsNode(true, async (node, provider, rpcNode) => {
            const announced: bigint[] = [];
            rpcNode.watchAnnouncedBlocks((block) => announced.push(block));
            await provider.on("block", () => undefined);
            await waitFor(() => node.subscribedSockets === 1);

            node.pushHeader();

            await waitFor(() => announced.includes(PUSHED_BLOCK));
        });
    });

    it("subscribes to newBlockHeaders again on the socket a node reopens, and emits its block events", async function () {
        await withHeadsNode(true, async (node, provider) => {
            const blocks: number[] = [];
            await provider.on("block", (block: number) => blocks.push(block));
            await waitFor(() => node.subscribedSockets === 1);

            node.dropSockets();
            await waitFor(() => node.subscribeKinds.length === 4);
            await waitFor(() => node.subscribedSockets === 1);
            node.pushHeader();

            await waitFor(() => blocks.includes(Number(PUSHED_BLOCK)));
            expect(node.subscribeKinds).to.deep.equal([
                "newHeads",
                "newBlockHeaders",
                "newHeads",
                "newBlockHeaders"
            ]);
        });
    });

    it("asks for no other kind when a node refuses newHeads without offering newBlockHeaders", async function () {
        await withHeadsNode(false, async (node, provider) => {
            await provider.on("block", () => undefined);
            await waitFor(() => node.subscribeKinds.length === 1);

            // time is the input: a second subscribe would come at once
            await sleep(ABSENCE_WINDOW_MS);

            // Mutation: any refusal of newHeads retried as newBlockHeaders
            expect(node.subscribeKinds).to.deep.equal(["newHeads"]);
        });
    });
});
