// @distributed-requires: lightClient
import { PARTITION_CONTRACT } from "@test/fixtures/lightClient/LightClientNodeFixture";
import { LightClientProviderFixture } from "@test/fixtures/lightClient/LightClientProviderFixture";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { toBeHex } from "ethers";

/** Channel ids, which the partition contract logs as its second topic. */
const CHANNEL_A = toBeHex(0xa1, 32);
const CHANNEL_B = toBeHex(0xa2, 32);
const SUBSCRIBE = "lightClient_subscribeStorage";
const UNSUBSCRIBE = "lightClient_unsubscribeStorage";
const PUSHED_BLOCK = "lightClient_storage";
const REFUSED_BLOCK = "Light client refused a pushed block";
/** The requests a proven read makes of the node when the pushed state does not answer it. */
const PROOF_REQUESTS = ["chain_getHeader", "state_getReadProof"];

/** A pushed block as the proxy hands it to a test to change. */
type PushedParams = {
    subscription: string;
    result: { values: { key: string; value: string | null }[] };
};

describe("Light client followed channel", function () {
    let fixture: LightClientProviderFixture | undefined;

    afterEach(async function () {
        await fixture?.stop();
        fixture = undefined;
    });

    it("answers reads of a followed channel's partition from the pushed state without a request to the node", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider } = fixture;
        const contract = await node.deploy(PARTITION_CONTRACT);
        await fixture.follow(contract, CHANNEL_A);
        const receipt = await node.readWriteLog(contract, CHANNEL_A, 5, 10, 7);
        await fixture.pushedThrough(receipt.blockNumber);
        const requestsBefore = fixture.forwardedCount(...PROOF_REQUESTS);

        expect(await provider.getStorage(contract, 10)).to.equal(
            toBeHex(7, 32)
        );
        expect(await provider.getStorage(contract, 5)).to.equal(toBeHex(0, 32));
        expect(await provider.getCode(contract)).to.equal(
            await node.provider.getCode(contract)
        );
        expect(await provider.getTransactionCount(node.senderAddress)).to.equal(
            await node.provider.getTransactionCount(node.senderAddress)
        );

        expect(fixture.forwardedCount(...PROOF_REQUESTS)).to.equal(
            requestsBefore
        );
        expect(fixture.forwardedReadCount()).to.equal(0);
        expect(provider.lightClientCounters).to.deep.include({
            fromPushedState: 4,
            failed: 0
        });
        expect(fixture.loggedErrors()).to.deep.equal([]);
    });

    it("runs a call from the channel's sender over the pushed partition without a request to the node", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider } = fixture;
        const contract = await node.deploy(PARTITION_CONTRACT);
        await fixture.follow(contract, CHANNEL_A);
        const receipt = await node.readWriteLog(contract, CHANNEL_A, 5, 10, 7);
        await fixture.pushedThrough(receipt.blockNumber);
        const requestsBefore = fixture.forwardedCount(...PROOF_REQUESTS);
        const call = {
            from: node.senderAddress,
            to: contract,
            data: toBeHex(10, 32)
        };

        expect(await provider.call(call)).to.equal(toBeHex(7, 32));
        expect(await node.provider.call(call)).to.equal(toBeHex(7, 32));
        expect(fixture.loggedErrors()).to.deep.equal([]);
        expect(provider.lightClientCounters).to.deep.equal({
            fromPushedState: 1,
            withFallbackRead: 0,
            leftToNodes: 0,
            failed: 0,
            unsupported: 0
        });

        expect(fixture.forwardedCount(...PROOF_REQUESTS)).to.equal(
            requestsBefore
        );
        expect(fixture.forwardedReadCount()).to.equal(0);
        expect(provider.lightClientCounters.fromPushedState).to.equal(1);
    });

    it("proves a read outside the partition at the pushed block, without asking for the best block", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider, proxy } = fixture;
        const contract = await node.deploy(PARTITION_CONTRACT);
        await fixture.follow(contract, CHANNEL_A);
        // slot 11 is only channel B's
        await node.readWriteLog(contract, CHANNEL_B, 11, 11, 3);
        const receipt = await node.readWriteLog(contract, CHANNEL_A, 5, 10, 7);
        await fixture.pushedThrough(receipt.blockNumber);
        const headersBefore = proxy.forwardedCount("chain_getHeader");
        const proofsBefore = proxy.forwardedCount("state_getReadProof");

        expect(await provider.getStorage(contract, 11)).to.equal(
            toBeHex(3, 32)
        );

        expect(proxy.forwardedCount("chain_getHeader")).to.equal(headersBefore);
        expect(proxy.forwardedCount("state_getReadProof")).to.equal(
            proofsBefore + 1
        );
        expect(provider.lightClientCounters).to.deep.include({
            fromPushedState: 0,
            withFallbackRead: 1
        });
    });

    it("answers with the value another channel's transaction wrote to a held key", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider } = fixture;
        const contract = await node.deploy(PARTITION_CONTRACT);
        await fixture.follow(contract, CHANNEL_A);
        await node.readWriteLog(contract, CHANNEL_A, 5, 10, 7);
        // channel B's transaction writes slot 5, which channel A's read
        const receipt = await node.readWriteLog(contract, CHANNEL_B, 11, 5, 9);
        await fixture.pushedThrough(receipt.blockNumber);
        const requestsBefore = fixture.forwardedCount(...PROOF_REQUESTS);

        expect(await provider.getStorage(contract, 5)).to.equal(toBeHex(9, 32));
        expect(fixture.forwardedCount(...PROOF_REQUESTS)).to.equal(
            requestsBefore
        );
        expect(provider.lightClientCounters.fromPushedState).to.equal(1);
    });

    it("refuses a push the proof decides otherwise, subscribes again and keeps answering proven reads", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider, proxy } = fixture;
        const contract = await node.deploy(PARTITION_CONTRACT);
        await fixture.follow(contract, CHANNEL_A);
        await node.readWriteLog(contract, CHANNEL_A, 5, 10, 7);
        await waitFor(() => provider.pushedStateCounters.acceptedBlocks > 1);
        let changed = false;
        proxy.changeNotifications(PUSHED_BLOCK, (params) => {
            const pushed = params as PushedParams;
            if (changed || pushed.result.values.length === 0) return params;
            changed = true;
            // no key of this partition ever holds this value
            pushed.result.values[0].value = toBeHex(0xdead, 32);
            return pushed;
        });

        const receipt = await node.readWriteLog(contract, CHANNEL_A, 10, 10, 1);
        await waitFor(() => proxy.forwardedCount(SUBSCRIBE) === 2);
        proxy.stopChangingNotifications(PUSHED_BLOCK);
        await fixture.pushedThrough(receipt.blockNumber + 1);

        expect(await provider.getStorage(contract, 10)).to.equal(
            toBeHex(8, 32)
        );
        expect(provider.pushedStateCounters).to.deep.include({
            refusedBlocks: 1,
            resubscriptions: 1
        });
        expect(proxy.forwardedCount(UNSUBSCRIBE)).to.equal(1);
        expect(fixture.loggedErrorMessages()).to.deep.equal([REFUSED_BLOCK]);
    });

    it("subscribes again on a socket that reopened and answers from its new sync", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider, proxy } = fixture;
        const contract = await node.deploy(PARTITION_CONTRACT);
        await fixture.follow(contract, CHANNEL_A);
        await node.readWriteLog(contract, CHANNEL_A, 5, 10, 7);

        proxy.cut();
        // a block the provider is not pushed
        const receipt = await node.readWriteLog(contract, CHANNEL_A, 10, 10, 1);
        proxy.restore();
        await waitFor(() => proxy.forwardedCount(SUBSCRIBE) === 2);
        await fixture.pushedThrough(receipt.blockNumber);
        const requestsBefore = fixture.forwardedCount(...PROOF_REQUESTS);

        expect(await provider.getStorage(contract, 10)).to.equal(
            toBeHex(8, 32)
        );
        expect(fixture.forwardedCount(...PROOF_REQUESTS)).to.equal(
            requestsBefore
        );
        expect(provider.lightClientCounters.fromPushedState).to.equal(1);
        expect(fixture.loggedErrors()).to.deep.equal([]);
    });

    it("reads at the node's best block again once the channel is unfollowed", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider, proxy } = fixture;
        const contract = await node.deploy(PARTITION_CONTRACT);
        await fixture.follow(contract, CHANNEL_A);
        const receipt = await node.readWriteLog(contract, CHANNEL_A, 5, 10, 7);
        await fixture.pushedThrough(receipt.blockNumber);

        provider.unfollowChannel(contract, CHANNEL_A);
        await waitFor(() => proxy.forwardedCount(UNSUBSCRIBE) === 1);
        const headersBefore = proxy.forwardedCount("chain_getHeader");

        expect(await provider.getStorage(contract, 10)).to.equal(
            toBeHex(7, 32)
        );
        expect(proxy.forwardedCount("chain_getHeader")).to.equal(
            headersBefore + 1
        );
        expect(provider.lightClientCounters).to.deep.include({
            fromPushedState: 0,
            withFallbackRead: 1
        });
    });

    it("follows nothing on a node without the light client endpoints", async function () {
        fixture = await LightClientProviderFixture.start({
            withoutEndpoints: true
        });
        const { node, provider, proxy } = fixture;
        const contract = await node.deploy(PARTITION_CONTRACT);
        await node.readWriteLog(contract, CHANNEL_A, 5, 10, 7);

        provider.followChannel(contract, CHANNEL_A);

        expect(await provider.getStorage(contract, 10)).to.equal(
            toBeHex(7, 32)
        );
        expect(proxy.forwardedCount("rpc_methods")).to.equal(1);
        expect(proxy.forwardedCount(SUBSCRIBE)).to.equal(0);
        expect(provider.lightClientCounters).to.deep.include({
            unsupported: 1
        });
        expect(fixture.loggedErrors()).to.deep.equal([]);
        expect(fixture.loggedInfoMessages()).to.include(
            "RPC node doesn't support LC endpoints; it answers the chain reads itself"
        );
    });

    it("follows over two endpoints and keeps answering from pushed state when one of them goes", async function () {
        fixture = await LightClientProviderFixture.start({ endpoints: 2 });
        const { node, provider, proxies } = fixture;
        const [first, second] = proxies;
        const contract = await node.deploy(PARTITION_CONTRACT);
        await fixture.follow(contract, CHANNEL_A);
        await waitFor(() =>
            proxies.every((proxy) => proxy.forwardedCount(SUBSCRIBE) === 1)
        );
        await node.readWriteLog(contract, CHANNEL_A, 5, 10, 7);

        first.cut();
        const receipt = await node.readWriteLog(contract, CHANNEL_A, 10, 10, 1);
        await waitFor(() =>
            second.sentNotifications.some(
                ({ method, params }) =>
                    method === PUSHED_BLOCK &&
                    Number(
                        (params as { result: { header: { number: string } } })
                            .result.header.number
                    ) >= receipt.blockNumber
            )
        );
        const requestsBefore = fixture.forwardedCount(...PROOF_REQUESTS);

        expect(await provider.getStorage(contract, 10)).to.equal(
            toBeHex(8, 32)
        );
        expect(fixture.forwardedCount(...PROOF_REQUESTS)).to.equal(
            requestsBefore
        );
        expect(provider.lightClientCounters).to.deep.include({
            fromPushedState: 1,
            failed: 0
        });
        expect(fixture.loggedErrors()).to.deep.equal([]);
    });

    it("keeps the other channel's subscription when one of two channels is unfollowed", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider, proxy } = fixture;
        const contract = await node.deploy(PARTITION_CONTRACT);
        await fixture.follow(contract, CHANNEL_A);
        provider.followChannel(contract, CHANNEL_B);
        await waitFor(() => proxy.forwardedCount(SUBSCRIBE) === 2);

        provider.unfollowChannel(contract, CHANNEL_A);
        await waitFor(() => proxy.forwardedCount(SUBSCRIBE) === 3);

        const subscriptions = proxy.forwardedRequests
            .filter(({ method }) => method === SUBSCRIBE)
            .map(({ params }) => (params as [{ topics: string[] }])[0].topics);
        expect(subscriptions).to.deep.equal([
            [CHANNEL_A],
            [CHANNEL_A, CHANNEL_B],
            [CHANNEL_B]
        ]);
        expect(proxy.forwardedCount(UNSUBSCRIBE)).to.equal(2);
        const receipt = await node.readWriteLog(contract, CHANNEL_B, 5, 12, 4);
        await fixture.pushedThrough(receipt.blockNumber);
        const requestsBefore = fixture.forwardedCount(...PROOF_REQUESTS);
        expect(await provider.getStorage(contract, 12)).to.equal(
            toBeHex(4, 32)
        );
        expect(fixture.forwardedCount(...PROOF_REQUESTS)).to.equal(
            requestsBefore
        );
    });

    it("tries a subscription that failed on an open connection again", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider, proxy } = fixture;
        const contract = await node.deploy(PARTITION_CONTRACT);
        proxy.failNextRequest(SUBSCRIBE);

        provider.followChannel(contract, CHANNEL_A);
        await waitFor(() => proxy.forwardedCount(SUBSCRIBE) === 2);
        const receipt = await node.readWriteLog(contract, CHANNEL_A, 5, 10, 7);
        await fixture.pushedThrough(receipt.blockNumber);
        const requestsBefore = fixture.forwardedCount(...PROOF_REQUESTS);

        expect(await provider.getStorage(contract, 10)).to.equal(
            toBeHex(7, 32)
        );
        expect(fixture.forwardedCount(...PROOF_REQUESTS)).to.equal(
            requestsBefore
        );
        expect(fixture.loggedErrorMessages()).to.deep.equal([
            "Light client subscription failed"
        ]);
    });

    it("keeps the stages of each accepted pushed block, in block order", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider } = fixture;
        const contract = await node.deploy(PARTITION_CONTRACT);
        await fixture.follow(contract, CHANNEL_A);
        const receipt = await node.readWriteLog(contract, CHANNEL_A, 5, 10, 7);
        await fixture.pushedThrough(receipt.blockNumber + 1);

        const timings = provider.pushedBlockTimings;
        expect(timings.length).to.equal(
            provider.pushedStateCounters.acceptedBlocks
        );
        expect(timings.map(({ number }) => number)).to.deep.equal(
            timings.map((_, index) => timings[0].number + index)
        );
        const written = timings.find(
            ({ number }) => number === receipt.blockNumber
        )!;
        expect(written.executedAt).to.be.a("number");
        expect(written.executedAt!).to.be.at.most(written.builtAt);
        expect(written.builtAt).to.be.at.most(written.sentAt);
        expect(written.sentAt).to.be.at.most(written.receivedAt);
        expect(written.receivedAt).to.be.at.most(written.verifiedAt);
        expect(written.newNodes).to.be.above(0);
        expect(written.heldNodes).to.be.at.least(written.newNodes);
    });
});
