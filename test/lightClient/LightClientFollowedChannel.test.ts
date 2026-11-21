// @distributed-requires: lightClient
import { PEER3_LIGHT_CLIENT_CHAIN } from "@/evm/p2pRuntime/rpcNodes/lightClient/LightClientChain";
import { sleep } from "@/utils";
import { tryHandleEvmError } from "@/utils/evmErrorHandler";
import { PARTITION_CONTRACT } from "@test/fixtures/lightClient/LightClientNodeFixture";
import { LightClientProviderFixture } from "@test/fixtures/lightClient/LightClientProviderFixture";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { isError, toBeHex, toQuantity } from "ethers";
import { ethers } from "hardhat";

/** Channel ids, which the partition contract logs as its second topic. */
const CHANNEL_A = toBeHex(0xa1, 32);
const CHANNEL_B = toBeHex(0xa2, 32);
const SUBSCRIBE = "lightClient_subscribeStorage";
const UNSUBSCRIBE = "lightClient_unsubscribeStorage";
const PUSHED_BLOCK = "lightClient_storage";
const REFUSED_BLOCK = "Light client refused a pushed block";
const FAILED_READ = "Light client failed a read; asking the nodes";
const UNSUBSCRIBE_FAILED =
    "Light client unsubscribe failed; the node may push to it until the socket closes";
/** Enough for the light client probe's deployment. */
const PROBE_DEPLOY_GAS = 9_000_000n;
/** The requests a proven read makes of the node when the pushed state does not answer it. */
const PROOF_REQUESTS = ["chain_getHeader", "state_getReadProof"];
/** The longest a read waits for a push of the block it must not read below. */
const PUSH_WAIT_MS = PEER3_LIGHT_CLIENT_CHAIN.blockTimeMs;
/** How long a failed subscription change waits before it is tried again: a block time. */
const SUBSCRIPTION_RETRY_DELAY_MS = PEER3_LIGHT_CLIENT_CHAIN.blockTimeMs;

/** A pushed block as the proxy hands it to a test to change. */
type PushedParams = {
    subscription: string;
    result: { values: { key: string; value: string | null }[] };
};
/** A pushed block's header as the proxy hands it to a test to change. */
type PushedHeaderParams = { result: { header: { number: string } } };
/** A pushed block's Ethereum header as the proxy hands it to a test to change. */
type PushedEthereumHeaderParams = {
    subscription: string;
    result: { ethereumHeader: string };
};

/** Drops the endpoint's new heads, so that only what the test names raises the block floor. */
function withoutNewHeads(params: unknown): unknown {
    const notified = params as { result?: { parentHash?: string } };
    return notified.result?.parentHash === undefined ? params : undefined;
}

/** How many blocks `proxy` pushed to its subscriptions. */
function pushedCount(proxy: {
    sentNotifications: { method: string }[];
}): number {
    return proxy.sentNotifications.filter(
        ({ method }) => method === PUSHED_BLOCK
    ).length;
}

describe("Light client followed channel", function () {
    let fixture: LightClientProviderFixture | undefined;

    afterEach(async function () {
        await fixture?.stop();
        fixture = undefined;
    });

    it("takes a sync pushed before the subscription's id reached it and answers reads from it", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider, proxy } = fixture;
        const contract = await node.deploy(PARTITION_CONTRACT);
        const receipt = await node.readWriteLog(contract, CHANNEL_A, 5, 10, 7);
        const subscribeAnswers = proxy.holdReplies(SUBSCRIBE);

        provider.followChannel(contract, CHANNEL_A);
        // the node's first push for the new id goes out before the id does
        await waitFor(
            () =>
                subscribeAnswers.heldReplies() === 1 &&
                proxy.sentNotifications.some(
                    ({ method }) => method === PUSHED_BLOCK
                )
        );
        subscribeAnswers.release();
        await fixture.pushedThrough(receipt.blockNumber + 1);
        const requestsBefore = fixture.forwardedCount(...PROOF_REQUESTS);

        expect(await provider.getStorage(contract, 10)).to.equal(
            toBeHex(7, 32)
        );
        expect(fixture.forwardedCount(...PROOF_REQUESTS)).to.equal(
            requestsBefore
        );
        expect(provider.pushedStateCounters).to.deep.include({
            refusedBlocks: 0,
            resubscriptions: 0
        });
        expect(fixture.loggedErrors()).to.deep.equal([]);
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
        // time is the oracle: three blocks give a subscription time to be made
        const followedAt = await node.provider.getBlockNumber();
        await waitFor(
            async () => (await node.provider.getBlockNumber()) >= followedAt + 3
        );
        expect(proxy.forwardedCount(SUBSCRIBE)).to.equal(0);
        expect(provider.pushedStateCounters.acceptedBlocks).to.equal(0);

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

    it("reads at the block the endpoint serving its requests pushed, not at a higher one another endpoint pushes", async function () {
        fixture = await LightClientProviderFixture.start({ endpoints: 2 });
        const { node, provider, proxies } = fixture;
        const [first, second] = proxies;
        const contract = await node.deploy(PARTITION_CONTRACT);
        // slot 11 is only channel B's
        await node.readWriteLog(contract, CHANNEL_B, 11, 11, 3);
        let forgedThrough = -1;
        second.changeNotifications(PUSHED_BLOCK, (params) => {
            const pushed = params as PushedHeaderParams;
            const number = Number(pushed.result.header.number);
            forgedThrough = Math.max(forgedThrough, number);
            // a made-up header far ahead, over the block's own state root
            pushed.result.header.number = toQuantity(number + 1_000_000);
            return pushed;
        });
        await fixture.follow(contract, CHANNEL_A);
        const receipt = await node.readWriteLog(contract, CHANNEL_A, 5, 10, 7);
        await fixture.pushedThrough(receipt.blockNumber);
        await waitFor(() => forgedThrough >= receipt.blockNumber);
        const proofsBefore = first.forwardedCount("state_getReadProof");

        expect(await provider.getStorage(contract, 11)).to.equal(
            toBeHex(3, 32)
        );
        expect(await provider.getStorage(contract, 10)).to.equal(
            toBeHex(7, 32)
        );
        expect(first.forwardedCount("state_getReadProof")).to.equal(
            proofsBefore + 1
        );
        // the made-up headers were taken, so only the read rule kept them out
        expect(provider.pushedStateCounters.refusedBlocks).to.equal(0);
        expect(provider.lightClientCounters).to.deep.include({
            fromPushedState: 1,
            withFallbackRead: 1,
            failed: 0
        });
        expect(fixture.loggedErrors()).to.deep.equal([]);
    });

    it("uses nothing a connection pushed once it ended: a read before the new sync is proven at the endpoint's best block", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider, proxy } = fixture;
        const contract = await node.deploy(PARTITION_CONTRACT);
        await fixture.follow(contract, CHANNEL_A);
        const written = await node.readWriteLog(contract, CHANNEL_A, 5, 10, 7);
        await fixture.pushedThrough(written.blockNumber);

        proxy.cut();
        // the new connection is pushed nothing, so no sync replaces the old state
        proxy.changeNotifications(PUSHED_BLOCK, () => undefined);
        await node.readWriteLog(contract, CHANNEL_A, 10, 10, 1);
        proxy.restore();
        await waitFor(() => proxy.forwardedCount(SUBSCRIBE) === 2);
        const headersBefore = proxy.forwardedCount("chain_getHeader");

        expect(await provider.getStorage(contract, 10)).to.equal(
            toBeHex(8, 32)
        );
        expect(proxy.forwardedCount("chain_getHeader")).to.equal(
            headersBefore + 1
        );
        expect(provider.lightClientCounters).to.deep.include({
            fromPushedState: 0,
            withFallbackRead: 1,
            failed: 0
        });
    });

    it("opens a subscription the endpoint ended again, counts it and answers from its new sync", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider, proxy } = fixture;
        const contract = await node.deploy(PARTITION_CONTRACT);
        await fixture.follow(contract, CHANNEL_A);
        await node.readWriteLog(contract, CHANNEL_A, 5, 10, 7);
        let ended = false;
        proxy.changeNotifications(PUSHED_BLOCK, (params) => {
            if (ended) return params;
            ended = true;
            // how the node ends a subscription that fell behind
            return {
                subscription: (params as PushedParams).subscription,
                error: { code: -32000, message: "subscription fell behind" }
            };
        });

        await waitFor(() => proxy.forwardedCount(SUBSCRIBE) === 2);
        proxy.stopChangingNotifications(PUSHED_BLOCK);
        const receipt = await node.readWriteLog(contract, CHANNEL_A, 10, 10, 1);
        await fixture.pushedThrough(receipt.blockNumber);
        const requestsBefore = fixture.forwardedCount(...PROOF_REQUESTS);

        expect(await provider.getStorage(contract, 10)).to.equal(
            toBeHex(8, 32)
        );
        expect(fixture.forwardedCount(...PROOF_REQUESTS)).to.equal(
            requestsBefore
        );
        expect(proxy.forwardedCount(UNSUBSCRIBE)).to.equal(1);
        expect(provider.pushedStateCounters).to.deep.include({
            refusedBlocks: 0,
            resubscriptions: 1
        });
        expect(fixture.loggedErrors()).to.deep.equal([]);
        expect(fixture.loggedWarningMessages()).to.include(
            "RPC node ended a light client subscription; subscribing again"
        );
    });

    it("reads a write right after its receipt from the push of the receipt's block", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider } = fixture;
        const contract = await node.deploy(PARTITION_CONTRACT);
        await fixture.follow(contract, CHANNEL_A);
        await node.readWriteLog(contract, CHANNEL_A, 5, 10, 7);
        const write = await node.readWriteLog(contract, CHANNEL_A, 10, 10, 1);
        const requestsBefore = fixture.forwardedCount(...PROOF_REQUESTS);

        await provider.getTransactionReceipt(write.hash);

        expect(await provider.getStorage(contract, 10)).to.equal(
            toBeHex(8, 32)
        );
        expect(fixture.forwardedCount(...PROOF_REQUESTS)).to.equal(
            requestsBefore
        );
        expect(provider.lightClientCounters).to.deep.include({
            fromPushedState: 1,
            withFallbackRead: 0,
            failed: 0
        });
    });

    it("reads at the endpoint's best block once the pushes stop, not at the last pushed block, and waits for them only once", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider, proxy } = fixture;
        const contract = await node.deploy(PARTITION_CONTRACT);
        await fixture.follow(contract, CHANNEL_A);
        const stale = await node.readWriteLog(contract, CHANNEL_A, 5, 10, 7);
        await fixture.pushedThrough(stale.blockNumber);
        // the socket stays open, but the endpoint pushes nothing more
        proxy.changeNotifications(PUSHED_BLOCK, () => undefined);
        const write = await node.readWriteLog(contract, CHANNEL_A, 10, 10, 1);

        await provider.getTransactionReceipt(write.hash);
        const waitedFrom = Date.now();
        expect(await provider.getStorage(contract, 10)).to.equal(
            toBeHex(8, 32)
        );
        const firstReadMs = Date.now() - waitedFrom;
        const againFrom = Date.now();
        expect(await provider.getStorage(contract, 10)).to.equal(
            toBeHex(8, 32)
        );
        const secondReadMs = Date.now() - againFrom;

        expect(firstReadMs).to.be.at.least(PUSH_WAIT_MS);
        expect(secondReadMs).to.be.below(PUSH_WAIT_MS);
        expect(provider.lightClientCounters).to.deep.include({
            fromPushedState: 0,
            withFallbackRead: 2,
            failed: 0
        });
        expect(fixture.loggedErrors()).to.deep.equal([]);
    });

    it("waits again for pushes once they arrive after a read stopped waiting, and reads from them", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider, proxy } = fixture;
        const contract = await node.deploy(PARTITION_CONTRACT);
        await fixture.follow(contract, CHANNEL_A);
        const first = await node.readWriteLog(contract, CHANNEL_A, 5, 10, 7);
        await fixture.pushedThrough(first.blockNumber);
        const stalled = proxy.holdNotifications(PUSHED_BLOCK);
        const missed = await node.readWriteLog(contract, CHANNEL_A, 10, 10, 1);
        await provider.getTransactionReceipt(missed.hash);
        // the push of the receipt's block is held past the read's wait
        expect(await provider.getStorage(contract, 10)).to.equal(
            toBeHex(8, 32)
        );
        stalled.release();
        await fixture.pushedThrough(missed.blockNumber);
        const late = proxy.holdNotifications(PUSHED_BLOCK);
        const write = await node.readWriteLog(contract, CHANNEL_A, 10, 10, 1);
        await provider.getTransactionReceipt(write.hash);
        const requestsBefore = fixture.forwardedCount(...PROOF_REQUESTS);

        const read = provider.getStorage(contract, 10);
        // released well within the wait, which the read is in
        await sleep(PUSH_WAIT_MS / 4);
        late.release();

        expect(await read).to.equal(toBeHex(9, 32));
        expect(fixture.forwardedCount(...PROOF_REQUESTS)).to.equal(
            requestsBefore
        );
        expect(provider.lightClientCounters).to.deep.include({
            fromPushedState: 1,
            withFallbackRead: 1,
            failed: 0
        });
        expect(provider.pushedStateCounters.refusedBlocks).to.equal(0);
        expect(fixture.loggedErrors()).to.deep.equal([]);
    });

    it("waits for no push of a block only an endpoint that does not serve the requests names in its new heads", async function () {
        fixture = await LightClientProviderFixture.start({ endpoints: 2 });
        const { node, provider, proxies } = fixture;
        const [, second] = proxies;
        let forgedHeads = 0;
        second.changeNotifications("eth_subscription", (params) => {
            const notified = params as {
                result: { number?: string; parentHash?: string };
            };
            if (notified.result.parentHash === undefined) return params;
            forgedHeads++;
            // a new head a million blocks ahead of the chain
            notified.result.number = toQuantity(
                Number(notified.result.number) + 1_000_000
            );
            return notified;
        });
        const contract = await node.deploy(PARTITION_CONTRACT);
        await fixture.follow(contract, CHANNEL_A);
        const receipt = await node.readWriteLog(contract, CHANNEL_A, 5, 10, 7);
        await fixture.pushedThrough(receipt.blockNumber);
        await waitFor(() => forgedHeads > 0);
        const requestsBefore = fixture.forwardedCount(...PROOF_REQUESTS);

        const readFrom = Date.now();
        expect(await provider.getStorage(contract, 10)).to.equal(
            toBeHex(7, 32)
        );

        expect(Date.now() - readFrom).to.be.below(PUSH_WAIT_MS);
        expect(fixture.forwardedCount(...PROOF_REQUESTS)).to.equal(
            requestsBefore
        );
        expect(provider.lightClientCounters).to.deep.include({
            fromPushedState: 1,
            withFallbackRead: 0,
            failed: 0
        });
        expect(fixture.loggedErrors()).to.deep.equal([]);
    });

    it("opens a subscription whose pushes keep being refused again at most once per block time", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider, proxy } = fixture;
        const contract = await node.deploy(PARTITION_CONTRACT);
        await fixture.follow(contract, CHANNEL_A);
        // every push from now on, sync included, carries an Ethereum header the digest does not name
        proxy.changeNotifications(PUSHED_BLOCK, (params) => {
            const pushed = params as { result: { ethereumHeader: string } };
            pushed.result.ethereumHeader = "0x00";
            return pushed;
        });
        await waitFor(() => proxy.forwardedCount(SUBSCRIBE) === 2);
        const reopenedAt = Date.now();

        await waitFor(() => proxy.forwardedCount(SUBSCRIBE) === 4);

        expect(Date.now() - reopenedAt).to.be.at.least(
            2 * SUBSCRIPTION_RETRY_DELAY_MS
        );
        expect(provider.pushedStateCounters.resubscriptions).to.be.at.least(3);
    });

    it("leaves an endpoint without the light client endpoints unsubscribed, and its reads to it once it serves the requests", async function () {
        fixture = await LightClientProviderFixture.start({ endpoints: 2 });
        const { node, provider, proxies } = fixture;
        const [first, second] = proxies;
        const { methods } = (await node.provider.send("rpc_methods", [])) as {
            methods: string[];
        };
        // the second endpoint is a node without the light client endpoints
        second.answerRequests("rpc_methods", {
            methods: methods.filter(
                (method) => !method.startsWith("lightClient_")
            )
        });
        second.rejectRequests(SUBSCRIBE, {
            code: -32601,
            message: "Method not found"
        });
        const contract = await node.deploy(PARTITION_CONTRACT);
        await fixture.follow(contract, CHANNEL_A);
        await waitFor(() => second.forwardedCount(SUBSCRIBE) === 1);
        const followedAt = await node.provider.getBlockNumber();
        await waitFor(
            async () => (await node.provider.getBlockNumber()) >= followedAt + 3
        );
        expect(second.forwardedCount(SUBSCRIBE)).to.equal(1);

        first.cut();
        await waitFor(() => !provider.nodes[0].isConnected);

        expect(await provider.getStorage(contract, 10)).to.equal(
            toBeHex(0, 32)
        );
        expect(second.forwardedCount("rpc_methods")).to.equal(1);
        expect(provider.lightClientCounters).to.deep.include({
            unsupported: 1,
            failed: 0
        });
        expect(fixture.loggedErrors()).to.deep.equal([]);
        expect(fixture.loggedInfoMessages()).to.include.members([
            "RPC node doesn't support LC endpoints; its socket is not subscribed",
            "RPC node doesn't support LC endpoints; it answers the chain reads itself"
        ]);
    });

    it("answers a partition read while another read waits for its proof, and the waiting read keeps its block", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider, proxy } = fixture;
        const contract = await node.deploy(PARTITION_CONTRACT);
        await fixture.follow(contract, CHANNEL_A);
        // slot 11 is only channel B's
        await node.readWriteLog(contract, CHANNEL_B, 11, 11, 3);
        const receipt = await node.readWriteLog(contract, CHANNEL_A, 5, 10, 7);
        await fixture.pushedThrough(receipt.blockNumber);
        const proofsBefore = proxy.forwardedCount("state_getReadProof");
        const release = proxy.holdRequests("state_getReadProof", 1);

        const waiting = provider.getStorage(contract, 11);
        await waitFor(
            () =>
                proxy.forwardedCount("state_getReadProof") === proofsBefore + 1
        );
        expect(await provider.getStorage(contract, 10)).to.equal(
            toBeHex(7, 32)
        );
        // a later block changes the waiting read's slot, and a read moves to it
        const later = await node.readWriteLog(contract, CHANNEL_B, 11, 11, 1);
        await fixture.pushedThrough(later.blockNumber);
        expect(await provider.getStorage(contract, 10)).to.equal(
            toBeHex(7, 32)
        );
        release();

        expect(await waiting).to.equal(toBeHex(3, 32));
        expect(proxy.forwardedCount("state_getReadProof")).to.equal(
            proofsBefore + 1
        );
        expect(provider.lightClientCounters).to.deep.include({
            fromPushedState: 2,
            withFallbackRead: 1,
            failed: 0
        });
    });

    it("starts following once the endpoint answers the methods question that failed when the channel was followed", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider, proxy } = fixture;
        const contract = await node.deploy(PARTITION_CONTRACT);
        proxy.failNextRequest("rpc_methods");

        provider.followChannel(contract, CHANNEL_A);
        await waitFor(() => proxy.forwardedCount(SUBSCRIBE) === 1);
        const receipt = await node.readWriteLog(contract, CHANNEL_A, 5, 10, 7);
        await fixture.pushedThrough(receipt.blockNumber);
        const requestsBefore = fixture.forwardedCount(...PROOF_REQUESTS);

        expect(await provider.getStorage(contract, 10)).to.equal(
            toBeHex(7, 32)
        );
        expect(fixture.forwardedCount(...PROOF_REQUESTS)).to.equal(
            requestsBefore
        );
        expect(proxy.forwardedCount("rpc_methods")).to.equal(2);
        expect(fixture.loggedErrorMessages()).to.deep.equal([
            "Light client could not start following; trying again"
        ]);
    });

    it("replays a transaction mined with no revert data at its receipt's block, past the pushed block, and sends nothing again", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider, proxy } = fixture;
        const contract = await node.deploy(PARTITION_CONTRACT);
        const probe = await ethers.getContractFactory("LightClientProbe");
        const address = await node.deploy(probe.bytecode, PROBE_DEPLOY_GAS);
        await fixture.follow(contract, CHANNEL_A);
        // the pushed state stays at a block where the probe's value is unset
        proxy.changeNotifications(PUSHED_BLOCK, () => undefined);
        await node.transact(
            address,
            probe.interface.encodeFunctionData("setValue", [1n])
        );
        const { sent, signer } = await node.sendThrough(provider, {
            to: address,
            data: probe.interface.encodeFunctionData("requireUnset"),
            gasLimit: 100_000n
        });
        const failure: unknown = await sent.wait().then(
            () => undefined,
            (error: unknown) => error
        );
        if (!isError(failure, "CALL_EXCEPTION") || !failure.receipt)
            throw new Error("Expected the transaction to be mined and fail");
        const requestsBefore = proxy.forwardedRequests.length;

        expect(await tryHandleEvmError(failure, { tx: sent, signer })).to.equal(
            false
        );

        const requests = proxy.forwardedRequests.slice(requestsBefore);
        expect(
            requests
                .filter(({ method }) => method === "eth_call")
                .map(({ params }) => (params as unknown[])[1])
        ).to.deep.equal([toQuantity(failure.receipt.blockNumber)]);
        const methods = requests.map(({ method }) => method);
        expect(methods).to.not.include("eth_estimateGas");
        expect(methods).to.not.include("eth_sendRawTransaction");
    });

    it("counts a read of state the endpoint proved for an earlier read at the same block as a fallback read, and asks for no proof again", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider, proxy } = fixture;
        // the read block stays the newest pushed one: no new head raises the floor
        proxy.changeNotifications("eth_subscription", withoutNewHeads);
        const contract = await node.deploy(PARTITION_CONTRACT);
        await fixture.follow(contract, CHANNEL_A);
        // slot 11 is only channel B's
        await node.readWriteLog(contract, CHANNEL_B, 11, 11, 3);
        const receipt = await node.readWriteLog(contract, CHANNEL_A, 5, 10, 7);
        await fixture.pushedThrough(receipt.blockNumber);
        const held = proxy.holdNotifications(PUSHED_BLOCK);

        expect(await provider.getStorage(contract, 11)).to.equal(
            toBeHex(3, 32)
        );
        const proofsBefore = proxy.forwardedCount("state_getReadProof");
        expect(await provider.getStorage(contract, 11)).to.equal(
            toBeHex(3, 32)
        );

        expect(proxy.forwardedCount("state_getReadProof")).to.equal(
            proofsBefore
        );
        expect(provider.lightClientCounters).to.deep.include({
            fromPushedState: 0,
            withFallbackRead: 2,
            failed: 0
        });
        held.release();
    });

    it("reads at the block of a log the serving endpoint delivered, waiting for its push", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider, proxy } = fixture;
        // only the delivered log raises the block floor
        proxy.changeNotifications("eth_subscription", withoutNewHeads);
        const contract = await node.deploy(PARTITION_CONTRACT);
        await fixture.follow(contract, CHANNEL_A);
        const logBlocks: number[] = [];
        await provider.on(
            { address: contract, topics: [null, CHANNEL_A] },
            (log: { blockNumber: number }) => logBlocks.push(log.blockNumber)
        );
        const first = await node.readWriteLog(contract, CHANNEL_A, 5, 10, 7);
        // the log subscription is live once it delivered the first log
        await waitFor(() => logBlocks.includes(first.blockNumber));
        await fixture.pushedThrough(first.blockNumber);
        const late = proxy.holdNotifications(PUSHED_BLOCK);
        const write = await node.readWriteLog(contract, CHANNEL_A, 10, 10, 1);
        await waitFor(() => logBlocks.includes(write.blockNumber));

        const read = provider.getStorage(contract, 10);
        // released well within the wait, which the read is in
        await sleep(PUSH_WAIT_MS / 4);
        late.release();

        expect(await read).to.equal(toBeHex(8, 32));
        expect(provider.lightClientCounters).to.deep.include({
            fromPushedState: 1,
            failed: 0
        });
        expect(fixture.loggedErrors()).to.deep.equal([]);
    });

    it("reads at the block of a log the serving endpoint answered a log search with, waiting for its push", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider, proxy } = fixture;
        // only the answered log search raises the block floor
        proxy.changeNotifications("eth_subscription", withoutNewHeads);
        const contract = await node.deploy(PARTITION_CONTRACT);
        await fixture.follow(contract, CHANNEL_A);
        const first = await node.readWriteLog(contract, CHANNEL_A, 5, 10, 7);
        await fixture.pushedThrough(first.blockNumber);
        const late = proxy.holdNotifications(PUSHED_BLOCK);
        const write = await node.readWriteLog(contract, CHANNEL_A, 10, 10, 1);
        const logs = await provider.getLogs({
            address: contract,
            fromBlock: write.blockNumber,
            toBlock: write.blockNumber
        });
        expect(logs.map((log) => log.blockNumber)).to.include(
            write.blockNumber
        );

        const read = provider.getStorage(contract, 10);
        // released well within the wait, which the read is in
        await sleep(PUSH_WAIT_MS / 4);
        late.release();

        expect(await read).to.equal(toBeHex(8, 32));
        expect(provider.lightClientCounters).to.deep.include({
            fromPushedState: 1,
            failed: 0
        });
        expect(fixture.loggedErrors()).to.deep.equal([]);
    });

    it("reads at a block the serving endpoint answered by number, waiting for its push", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider, proxy } = fixture;
        // only the answered block raises the block floor
        proxy.changeNotifications("eth_subscription", withoutNewHeads);
        const contract = await node.deploy(PARTITION_CONTRACT);
        await fixture.follow(contract, CHANNEL_A);
        const first = await node.readWriteLog(contract, CHANNEL_A, 5, 10, 7);
        await fixture.pushedThrough(first.blockNumber);
        const late = proxy.holdNotifications(PUSHED_BLOCK);
        const write = await node.readWriteLog(contract, CHANNEL_A, 10, 10, 1);
        expect((await provider.getBlock(write.blockNumber))?.number).to.equal(
            write.blockNumber
        );

        const read = provider.getStorage(contract, 10);
        // released well within the wait, which the read is in
        await sleep(PUSH_WAIT_MS / 4);
        late.release();

        expect(await read).to.equal(toBeHex(8, 32));
        expect(provider.lightClientCounters).to.deep.include({
            fromPushedState: 1,
            failed: 0
        });
        expect(fixture.loggedErrors()).to.deep.equal([]);
    });

    it("raises no block floor from the pending block the serving endpoint answered, and reads from the pushed state at once", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider, proxy } = fixture;
        // only the answered pending block could raise the block floor
        proxy.changeNotifications("eth_subscription", withoutNewHeads);
        const contract = await node.deploy(PARTITION_CONTRACT);
        await fixture.follow(contract, CHANNEL_A);
        const write = await node.readWriteLog(contract, CHANNEL_A, 5, 10, 7);
        await fixture.pushedThrough(write.blockNumber);
        // no later push arrives, so a floor above the pushed blocks is never met from pushed state
        const later = proxy.holdNotifications(PUSHED_BLOCK);
        // the peer3 node numbers its pending block at its best block; the
        // endpoint answers it one above, as geth and Hardhat number it
        const pending = await node.provider.send("eth_getBlockByNumber", [
            "pending",
            false
        ]);
        const above = toQuantity(Number(pending.number) + 1);
        proxy.answerRequests("eth_getBlockByNumber", {
            ...pending,
            number: above
        });
        expect(
            (await provider.send("eth_getBlockByNumber", ["pending", false]))
                .number
        ).to.equal(above);

        expect(await provider.getStorage(contract, 10)).to.equal(
            toBeHex(7, 32)
        );

        expect(provider.lightClientCounters).to.deep.include({
            fromPushedState: 1,
            withFallbackRead: 0,
            failed: 0
        });
        expect(fixture.loggedErrors()).to.deep.equal([]);
        later.release();
    });

    it("leaves a read to the endpoint as a failed one when the endpoint's best block is below the block it has shown", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider, proxy } = fixture;
        const contract = await node.deploy(PARTITION_CONTRACT);
        await fixture.follow(contract, CHANNEL_A);
        const stale = await node.readWriteLog(contract, CHANNEL_A, 5, 10, 7);
        await fixture.pushedThrough(stale.blockNumber);
        // the socket stays open, but the endpoint pushes nothing more
        proxy.changeNotifications(PUSHED_BLOCK, () => undefined);
        const write = await node.readWriteLog(contract, CHANNEL_A, 10, 10, 1);
        await provider.getTransactionReceipt(write.hash);
        // the endpoint names an earlier best block, as a lagging replica behind it would
        const earlier = await node.provider.send("chain_getBlockHash", [
            write.blockNumber - 1
        ]);
        proxy.answerRequests(
            "chain_getHeader",
            await node.provider.send("chain_getHeader", [earlier])
        );

        expect(await provider.getStorage(contract, 10)).to.equal(
            toBeHex(8, 32)
        );

        expect(provider.lightClientCounters).to.deep.include({
            fromPushedState: 0,
            withFallbackRead: 0,
            failed: 1
        });
        expect(fixture.loggedErrorMessages()).to.deep.equal([FAILED_READ]);
        expect(String(fixture.loggedErrors()[0].meta[0].error)).to.include(
            "below the block floor"
        );
    });

    it("waits only once for a serving endpoint whose pushes stopped while another endpoint keeps pushing", async function () {
        fixture = await LightClientProviderFixture.start({ endpoints: 2 });
        const { node, provider, proxies } = fixture;
        const [first, second] = proxies;
        const contract = await node.deploy(PARTITION_CONTRACT);
        await fixture.follow(contract, CHANNEL_A);
        const stale = await node.readWriteLog(contract, CHANNEL_A, 5, 10, 7);
        await fixture.pushedThrough(stale.blockNumber);
        // the serving endpoint's socket stays open, but it pushes nothing more
        first.changeNotifications(PUSHED_BLOCK, () => undefined);
        const write = await node.readWriteLog(contract, CHANNEL_A, 10, 10, 1);
        await provider.getTransactionReceipt(write.hash);

        const waitedFrom = Date.now();
        expect(await provider.getStorage(contract, 10)).to.equal(
            toBeHex(8, 32)
        );
        const firstReadMs = Date.now() - waitedFrom;
        const secondPushes = pushedCount(second);
        await waitFor(() => pushedCount(second) > secondPushes);
        const againFrom = Date.now();
        expect(await provider.getStorage(contract, 10)).to.equal(
            toBeHex(8, 32)
        );
        const secondReadMs = Date.now() - againFrom;

        expect(firstReadMs).to.be.at.least(PUSH_WAIT_MS);
        expect(secondReadMs).to.be.below(PUSH_WAIT_MS);
        expect(fixture.loggedErrors()).to.deep.equal([]);
    });

    it("asks an endpoint whose connection reopened again whether it serves the light client, and answers from proven state once it does", async function () {
        fixture = await LightClientProviderFixture.start({
            withoutEndpoints: true
        });
        const { node, provider, proxy } = fixture;
        const [endpoint] = provider.nodes;
        const contract = await node.deploy(PARTITION_CONTRACT);
        await node.readWriteLog(contract, CHANNEL_A, 5, 10, 7);
        expect(await provider.getStorage(contract, 10)).to.equal(
            toBeHex(7, 32)
        );
        expect(provider.lightClientCounters.unsupported).to.equal(1);

        // the endpoint behind the same URL now serves the light client
        proxy.stopAnsweringRequests("rpc_methods");
        proxy.cut();
        await waitFor(() => !endpoint.isConnected);
        proxy.restore();
        await waitFor(() => endpoint.isConnected);

        expect(await provider.getStorage(contract, 10)).to.equal(
            toBeHex(7, 32)
        );
        // asked of the node itself now, no longer answered by the proxy
        expect(proxy.forwardedCount("rpc_methods")).to.be.at.least(1);
        expect(provider.lightClientCounters).to.deep.include({
            unsupported: 1,
            withFallbackRead: 1,
            failed: 0
        });
    });

    it("opens a refused subscription again when the endpoint fails its unsubscribe, with a warning and no error", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider, proxy } = fixture;
        const contract = await node.deploy(PARTITION_CONTRACT);
        await fixture.follow(contract, CHANNEL_A);
        await node.readWriteLog(contract, CHANNEL_A, 5, 10, 7);
        await waitFor(() => provider.pushedStateCounters.acceptedBlocks > 1);
        proxy.rejectRequests(UNSUBSCRIBE, {
            code: -32000,
            message: "unsubscribe failed"
        });
        let changed = false;
        proxy.changeNotifications(PUSHED_BLOCK, (params) => {
            const pushed = params as PushedEthereumHeaderParams;
            if (changed) return params;
            changed = true;
            pushed.result.ethereumHeader = "0x00";
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
        expect(fixture.loggedErrorMessages()).to.deep.equal([REFUSED_BLOCK]);
        expect(fixture.loggedWarningMessages()).to.include(UNSUBSCRIBE_FAILED);
    });

    it("hands on no push of a refused subscription that arrives before the endpoint ends it, and counts the refusal once", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider, proxy } = fixture;
        const contract = await node.deploy(PARTITION_CONTRACT);
        const other = await node.deploy(PARTITION_CONTRACT);
        await fixture.follow(contract, CHANNEL_A);
        await node.readWriteLog(contract, CHANNEL_A, 5, 10, 7);
        await waitFor(() => provider.pushedStateCounters.acceptedBlocks > 1);
        const [{ params }] = proxy.sentNotifications
            .filter(({ method }) => method === PUSHED_BLOCK)
            .slice(-1);
        const { subscription } = params as PushedEthereumHeaderParams;
        // the next subscription change waits for its answer, and the end of a refused subscription waits behind it
        const subscribing = proxy.holdReplies(SUBSCRIBE);
        provider.followChannel(other, CHANNEL_B);
        await waitFor(() => subscribing.heldReplies() === 1);
        let refused = 0;
        proxy.changeNotifications(PUSHED_BLOCK, (notified) => {
            const pushed = notified as PushedEthereumHeaderParams;
            if (pushed.subscription !== subscription) return notified;
            refused++;
            pushed.result.ethereumHeader = "0x00";
            return pushed;
        });

        await waitFor(() => refused >= 3);
        expect(provider.pushedStateCounters.refusedBlocks).to.equal(1);
        proxy.stopChangingNotifications(PUSHED_BLOCK);
        subscribing.release();
        await waitFor(() => proxy.forwardedCount(SUBSCRIBE) === 3);
        const receipt = await node.readWriteLog(contract, CHANNEL_A, 10, 10, 1);
        await fixture.pushedThrough(receipt.blockNumber + 1);

        expect(await provider.getStorage(contract, 10)).to.equal(
            toBeHex(8, 32)
        );
        expect(provider.pushedStateCounters.refusedBlocks).to.equal(1);
        expect(fixture.loggedErrorMessages()).to.deep.equal([REFUSED_BLOCK]);
    });

    it("reads the followed contract's slots from the push and proves another contract's account, then its slots, in two requests", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider, proxy } = fixture;
        const probe = await ethers.getContractFactory("LightClientProbe");
        const followed = await node.deploy(probe.bytecode, PROBE_DEPLOY_GAS);
        // as an ERC-20 the channel's contract reads: no channel transaction touches it
        const token = await node.deploy(probe.bytecode, PROBE_DEPLOY_GAS);
        await node.transact(
            token,
            probe.interface.encodeFunctionData("link", [8n])
        );
        await fixture.follow(followed, CHANNEL_A);
        await node.transact(
            followed,
            probe.interface.encodeFunctionData("touch", [CHANNEL_A, 1n, 5n])
        );
        const last = await node.transact(
            followed,
            probe.interface.encodeFunctionData("touch", [CHANNEL_A, 2n, 6n])
        );
        await fixture.pushedThrough(last.blockNumber);
        const call = {
            from: node.senderAddress,
            to: followed,
            data: probe.interface.encodeFunctionData("sumWith", [
                token,
                [1n, 2n],
                [0n, 1n, 2n, 3n]
            ])
        };
        const sent = proxy.forwardedRequests.length;

        const answer = await provider.call(call);

        expect(answer).to.equal(await node.provider.call(call));
        // 5 + 6 from the push, 1 + 2 + 3 + 4 proven on request
        expect(BigInt(answer)).to.equal(21n);
        const proofKeyCounts = proxy.forwardedRequests
            .slice(sent)
            .filter(({ method }) => method === "state_getReadProof")
            .map(({ params }) => (params as [string[]])[0].length);
        // the token's account and code first; its four slots only once its code ran
        expect(proofKeyCounts).to.deep.equal([2, 4]);
        expect(provider.lightClientCounters).to.deep.include({
            fromPushedState: 0,
            withFallbackRead: 1,
            failed: 0
        });
    });
});
