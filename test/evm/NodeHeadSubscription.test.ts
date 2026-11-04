import { sleep } from "@/utils";
import {
    NEW_BLOCK_HEADERS_SUBSCRIPTION,
    PUSHED_BLOCK,
    withNewBlockHeadersProvider
} from "@test/fixtures/node/NewBlockHeadersNode";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

/** Time is the input: how long a subscribe or block event that must not come is watched for. */
const ABSENCE_WINDOW_MS = 300;

describe("Node head subscription", function () {
    it("emits block events from newBlockHeaders on a node that refuses newHeads and offers newBlockHeaders", async function () {
        await withNewBlockHeadersProvider(true, async (node, provider) => {
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

    // Mutation: a newBlockHeaders push announced as a log's block -> a lower
    // head after a reorganization would not lower the node's announced block.
    it("announces the blocks of newBlockHeaders pushes to the node's announcement watchers as heads", async function () {
        await withNewBlockHeadersProvider(
            true,
            async (node, provider, rpcNode) => {
                const heads: bigint[] = [];
                rpcNode.watchAnnouncedBlocks((block, isHead) => {
                    if (isHead) heads.push(block);
                });
                await provider.on("block", () => undefined);
                await waitFor(() => node.subscribedSockets === 1);

                node.pushHeader();

                await waitFor(() => heads.includes(PUSHED_BLOCK));
            }
        );
    });

    it("subscribes to newBlockHeaders again on the socket a node reopens, and emits its block events", async function () {
        await withNewBlockHeadersProvider(true, async (node, provider) => {
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

    it("unsubscribes the newBlockHeaders subscription when the last block listener is removed", async function () {
        await withNewBlockHeadersProvider(true, async (node, provider) => {
            const blocks: number[] = [];
            const listener = (block: number) => blocks.push(block);
            await provider.on("block", listener);
            await waitFor(() => node.subscribedSockets === 1);

            await provider.off("block", listener);

            // Mutation: the fallback's subscription never unsubscribed, red
            await waitFor(() => node.subscribedSockets === 0);
            expect(node.unsubscribedIds).to.deep.equal([
                NEW_BLOCK_HEADERS_SUBSCRIPTION
            ]);
            node.pushHeader();
            // time is the input: a block event would come at once
            await sleep(ABSENCE_WINDOW_MS);
            expect(blocks).to.deep.equal([]);
        });
    });

    it("asks for no other kind when a node refuses newHeads without offering newBlockHeaders", async function () {
        await withNewBlockHeadersProvider(false, async (node, provider) => {
            await provider.on("block", () => undefined);
            await waitFor(() => node.subscribeKinds.length === 1);

            // time is the input: a second subscribe would come at once
            await sleep(ABSENCE_WINDOW_MS);

            // Mutation: any refusal of newHeads retried as newBlockHeaders
            expect(node.subscribeKinds).to.deep.equal(["newHeads"]);
        });
    });
});
