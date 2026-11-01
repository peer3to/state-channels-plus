import {
    RecordedAssetHubNode,
    RecordedRelayNode,
    recorded
} from "../../fixtures/node/RecordedPolkadotNodes";
import { StorageDiffClient } from "../../fixtures/node/StorageDiffClient";
import {
    withStorageDiffSession,
    withStorageDiffUpstream
} from "../../fixtures/node/StorageDiffSession";
import { DepthIncludedHeadStrategy } from "@/utils/node/storageDiff/includedHead/DepthIncludedHeadStrategy";
import { RelayIncludedHeadStrategy } from "@/utils/node/storageDiff/includedHead/RelayIncludedHeadStrategy";
import { expect } from "chai";
import { toQuantity } from "ethers";

const NOT_AN_ANCESTOR = "Included head is not an ancestor of the best head";

describe("StorageDiffService included head", function () {
    it("pushes the block a fixed depth behind the best head to a subscriber as the included head", async function () {
        await withStorageDiffSession(
            async ({ client, provider }) => {
                await client.subscribe([]);

                await provider.send("anvil_mine", [5]);

                const head = Number(await provider.send("eth_blockNumber", []));
                const pushed = await client.includedHeadAt(head - 2);
                const block = await provider.getBlock(head - 2);
                expect(pushed).to.deep.equal({
                    number: toQuantity(head - 2),
                    hash: block!.hash
                });
            },
            { includedHead: new DepthIncludedHeadStrategy(2) }
        );
    });

    it("returns the included head with the catch-up of a reconnecting peer", async function () {
        await withStorageDiffSession(
            async ({ client, provider, service }) => {
                await client.subscribe([]);
                await provider.send("anvil_mine", [4]);
                const head = Number(await provider.send("eth_blockNumber", []));
                const pushed = await client.includedHeadAt(head - 1);

                const reconnected = await StorageDiffClient.connect(
                    service.url
                );
                try {
                    const catchUp = await reconnected.catchUp([], 0);
                    expect(catchUp.includedHead).to.deep.equal(pushed);
                    expect(catchUp.records.map((r) => r.number)).to.include(
                        toQuantity(head)
                    );
                } finally {
                    reconnected.close();
                }
            },
            { includedHead: new DepthIncludedHeadStrategy(1) }
        );
    });

    it("returns the included head with a catch-up that starts after the best head", async function () {
        await withStorageDiffSession(
            async ({ client, provider }) => {
                await provider.send("anvil_mine", [3]);
                const head = Number(await provider.send("eth_blockNumber", []));

                const catchUp = await client.catchUp([], head + 1);

                expect(catchUp.records).to.deep.equal([]);
                expect(catchUp.includedHead).to.not.equal(null);
            },
            { includedHead: new DepthIncludedHeadStrategy(1) }
        );
    });

    it("returns a null included head when the service has no inclusion strategy", async function () {
        await withStorageDiffSession(async ({ client }) => {
            const catchUp = await client.catchUp([], 0);

            expect(catchUp.includedHead).to.equal(null);
        });
    });

    it("pushes no included head to a peer that holds no subscription", async function () {
        await withStorageDiffSession(
            async ({ client, provider, service }) => {
                const bystander = await StorageDiffClient.connect(service.url);
                try {
                    await client.subscribe([]);
                    await provider.send("anvil_mine", [3]);
                    const head = Number(
                        await provider.send("eth_blockNumber", [])
                    );
                    await client.includedHeadAt(head - 1);

                    // A reply arrives after every push sent before it.
                    await bystander.catchUp([], 0);
                    expect(bystander.unreadIncludedHeads()).to.deep.equal([]);
                } finally {
                    bystander.close();
                }
            },
            { includedHead: new DepthIncludedHeadStrategy(1) }
        );
    });

    it("logs a warning when the included head is not on the best chain after a reorg", async function () {
        await withStorageDiffUpstream(async ({ provider, start, warnings }) => {
            const service = await start({
                includedHead: new DepthIncludedHeadStrategy(1)
            });
            const client = await StorageDiffClient.connect(service.url);
            try {
                const subscription = await client.subscribe([]);
                await provider.send("anvil_mine", [4]);
                const head = Number(await provider.send("eth_blockNumber", []));
                await client.includedHeadAt(head - 1);
                expect(
                    warnings.filter((w) => w.message === NOT_AN_ANCESTOR)
                ).to.have.length(0);

                await provider.send("anvil_reorg", [3, []]);
                await provider.send("evm_mine", []);
                await client.recordAt(subscription, head + 1);

                const reported = warnings.filter(
                    (w) => w.message === NOT_AN_ANCESTOR
                );
                expect(reported).to.have.length(1);
                expect(reported[0].meta[0]).to.include({
                    includedNumber: toQuantity(head - 1)
                });
            } finally {
                client.close();
            }
        });
    });

    it("logs no warning while the included head stays on the best chain through a shallow reorg", async function () {
        await withStorageDiffUpstream(async ({ provider, start, warnings }) => {
            const service = await start({
                includedHead: new DepthIncludedHeadStrategy(3)
            });
            const client = await StorageDiffClient.connect(service.url);
            try {
                const subscription = await client.subscribe([]);
                await provider.send("anvil_mine", [6]);
                const head = Number(await provider.send("eth_blockNumber", []));
                await client.includedHeadAt(head - 3);

                await provider.send("anvil_reorg", [1, []]);
                await provider.send("evm_mine", []);
                await client.recordAt(subscription, head + 1);

                expect(
                    warnings.filter((w) => w.message === NOT_AN_ANCESTOR)
                ).to.have.length(0);
            } finally {
                client.close();
            }
        });
    });

    it("pushes the eth block of each relay-included Asset Hub block, reading its hash once per inclusion", async function () {
        const relayNode = await RecordedRelayNode.start();
        const assetHub = await RecordedAssetHubNode.start();
        try {
            await withStorageDiffSession(
                async ({ client }) => {
                    await client.subscribe([]);
                    const [first, second] = recorded.fixtures;

                    expect(
                        (await client.catchUp([], 0)).includedHead
                    ).to.deep.equal({
                        number: toQuantity(first.number),
                        hash: first.ethHashFromEthRpc
                    });
                    relayNode.announce(1);

                    expect(
                        await client.includedHeadAt(second.number)
                    ).to.deep.equal({
                        number: toQuantity(second.number),
                        hash: second.ethHashFromEthRpc
                    });
                    expect(assetHub.requestCount("state_getStorage")).to.equal(
                        2
                    );
                    expect(
                        relayNode.requestCount("state_subscribeStorage")
                    ).to.equal(1);

                    // An older announcement moves the included head back never.
                    relayNode.announce(0);
                    relayNode.announce(1);
                    await assetHub.requestsReached("state_getStorage", 4);
                    expect(
                        (await client.catchUp([], 0)).includedHead
                    ).to.deep.equal({
                        number: toQuantity(second.number),
                        hash: second.ethHashFromEthRpc
                    });
                    expect(client.unreadIncludedHeads()).to.deep.equal([]);
                },
                {
                    includedHead: new RelayIncludedHeadStrategy({
                        relayUrl: relayNode.url,
                        assetHubUrl: assetHub.url,
                        paraId: recorded.paraId
                    })
                }
            );
        } finally {
            await relayNode.close();
            await assetHub.close();
        }
    });

    it("resubscribes to the relay chain after the connection drops and keeps pushing", async function () {
        const relayNode = await RecordedRelayNode.start();
        const assetHub = await RecordedAssetHubNode.start();
        try {
            await withStorageDiffSession(
                async ({ client }) => {
                    await client.subscribe([]);
                    const [, second] = recorded.fixtures;

                    relayNode.disconnect();
                    await relayNode.requestsReached(
                        "state_subscribeStorage",
                        2
                    );
                    relayNode.announce(1);

                    expect(
                        await client.includedHeadAt(second.number)
                    ).to.deep.equal({
                        number: toQuantity(second.number),
                        hash: second.ethHashFromEthRpc
                    });
                },
                {
                    includedHead: new RelayIncludedHeadStrategy({
                        relayUrl: relayNode.url,
                        assetHubUrl: assetHub.url,
                        paraId: recorded.paraId
                    })
                }
            );
        } finally {
            await relayNode.close();
            await assetHub.close();
        }
    });
});
