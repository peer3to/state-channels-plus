// @distributed-requires: lightClient
import { STORE_LOG_AND_READ_CONTRACT } from "@test/fixtures/lightClient/LightClientNodeFixture";
import { LightClientProviderFixture } from "@test/fixtures/lightClient/LightClientProviderFixture";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { toBeHex } from "ethers";

/** The contract logs the slot a transaction stored at: a slot stands for a channel id. */
const SLOT_ONE = toBeHex(1, 32);
const SLOT_TWO = toBeHex(2, 32);
const FIRST = toBeHex(0xaaaa, 32);
const SECOND = toBeHex(0xbbbb, 32);
/** Above the chain's existential deposit, which a balance read keeps back. */
const PAID = 3_000_000_000_000_000n;
const SUBSCRIBE = "lightClient_subscribeStorage";
const UNSUBSCRIBE = "lightClient_unsubscribeStorage";
const PUSHED_BLOCK = "lightClient_storage";
const REFUSED_BLOCK = "Light client refused a pushed block";
const CHANGED_UNPUSHED =
    "Light client held storage that changed in blocks pushed without the write";
const NOTHING_WRONG = { refusedBlocks: 0, changedUnpushed: 0 };

/** A pushed block as the proxy hands it to a test to change. */
type PushedParams = {
    subscription: string;
    result: {
        writes: { slot: string; value: string | null }[];
        proofNodes: string[];
    };
};

describe("Light client followed channel", function () {
    let fixture: LightClientProviderFixture | undefined;

    afterEach(async function () {
        await fixture?.stop();
        fixture = undefined;
    });

    it("reads a followed contract's storage at a later block from the pushed blocks without a proof", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider } = fixture;
        const contract = await node.deploy(STORE_LOG_AND_READ_CONTRACT);
        await node.store(contract, SLOT_ONE, FIRST);
        const followedAt = await fixture.follow(contract, SLOT_ONE);
        await fixture.readAtBlock(followedAt);
        expect(await provider.getStorage(contract, SLOT_ONE)).to.equal(FIRST);
        expect(await provider.getStorage(contract, SLOT_TWO)).to.equal(
            toBeHex(0, 32)
        );

        const receipt = await node.store(contract, SLOT_ONE, SECOND);
        await fixture.pushedThrough(receipt.blockNumber);
        await fixture.readAtBlock(receipt.blockNumber);
        const proofsBefore = fixture.provenSlotCounts().length;

        expect(await provider.getStorage(contract, SLOT_ONE)).to.equal(SECOND);
        expect(await provider.getStorage(contract, SLOT_TWO)).to.equal(
            toBeHex(0, 32)
        );
        expect(
            await node.provider.getStorage(
                contract,
                SLOT_ONE,
                receipt.blockNumber
            )
        ).to.equal(SECOND);
        expect(fixture.provenSlotCounts().length).to.equal(proofsBefore);
        expect(provider.pushedStateCounters).to.deep.include({
            reproofs: 0,
            ...NOTHING_WRONG
        });
        expect(provider.pushedStateCounters.acceptedBlocks).to.be.at.least(
            receipt.blockNumber - followedAt
        );
        expect(provider.lightClientCounters).to.deep.include({
            answeredLocally: 4,
            failed: 0
        });
        expect(fixture.loggedErrors()).to.deep.equal([]);
    });

    it("runs a call over a followed contract's pushed storage without proving a slot", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider } = fixture;
        const contract = await node.deploy(STORE_LOG_AND_READ_CONTRACT);
        await node.store(contract, SLOT_ONE, FIRST);
        const followedAt = await fixture.follow(contract, SLOT_ONE);
        await fixture.readAtBlock(followedAt);
        const call = { to: contract, data: SLOT_ONE };
        expect(await provider.call(call)).to.equal(FIRST);

        const receipt = await node.store(contract, SLOT_ONE, SECOND);
        await fixture.pushedThrough(receipt.blockNumber);
        await fixture.readAtBlock(receipt.blockNumber);
        const proofsBefore = fixture.provenSlotCounts().length;

        expect(await provider.call(call)).to.equal(SECOND);
        expect(
            await node.provider.call({
                ...call,
                blockTag: receipt.blockNumber
            })
        ).to.equal(SECOND);
        // the block's values, the contract's account and code: no slot
        expect(
            fixture
                .provenSlotCounts()
                .slice(proofsBefore)
                .every((slots) => slots === 0)
        ).to.equal(true);
        expect(provider.pushedStateCounters).to.deep.include({
            reproofs: 0,
            ...NOTHING_WRONG
        });
        expect(fixture.loggedErrors()).to.deep.equal([]);
    });

    it("proves a slot the pushed blocks wrote but no read held before", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider } = fixture;
        const contract = await node.deploy(STORE_LOG_AND_READ_CONTRACT);
        const followedAt = await fixture.follow(contract, SLOT_ONE);
        await fixture.readAtBlock(followedAt);
        expect(await provider.getStorage(contract, SLOT_TWO)).to.equal(
            toBeHex(0, 32)
        );

        const receipt = await node.store(contract, SLOT_ONE, FIRST);
        await fixture.pushedThrough(receipt.blockNumber);
        await fixture.readAtBlock(receipt.blockNumber);
        const proofsBefore = fixture.provenSlotCounts().length;

        expect(await provider.getStorage(contract, SLOT_ONE)).to.equal(FIRST);
        expect(fixture.provenSlotCounts().slice(proofsBefore)).to.deep.equal([
            1
        ]);
        expect(provider.pushedStateCounters).to.deep.include({
            reproofs: 0,
            ...NOTHING_WRONG
        });
    });

    it("proves a followed contract's balance at the read's block, because only its storage is kept", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider } = fixture;
        const contract = await node.deploy(STORE_LOG_AND_READ_CONTRACT);
        const followedAt = await fixture.follow(contract, SLOT_ONE);
        await fixture.readAtBlock(followedAt);
        expect(await provider.getStorage(contract, SLOT_ONE)).to.equal(
            toBeHex(0, 32)
        );
        expect(await provider.getBalance(contract)).to.equal(0n);

        const receipt = await node.store(contract, SLOT_ONE, FIRST, PAID);
        await fixture.pushedThrough(receipt.blockNumber);
        await fixture.readAtBlock(receipt.blockNumber);

        const balance = await provider.getBalance(contract);
        expect(balance).to.equal(
            await node.provider.getBalance(contract, receipt.blockNumber)
        );
        expect(balance > 0n).to.equal(true);
        expect(await provider.getStorage(contract, SLOT_ONE)).to.equal(FIRST);
        expect(provider.pushedStateCounters).to.deep.include({
            reproofs: 0,
            ...NOTHING_WRONG
        });
        expect(fixture.loggedErrors()).to.deep.equal([]);
    });

    it("proves all held storage of a followed contract in one request when the pushed blocks do not reach the read's block", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider, proxy } = fixture;
        const contract = await node.deploy(STORE_LOG_AND_READ_CONTRACT);
        await node.store(contract, SLOT_ONE, FIRST);
        const followedAt = await fixture.follow(contract, SLOT_ONE);
        await fixture.readAtBlock(followedAt);
        expect(await provider.getStorage(contract, SLOT_ONE)).to.equal(FIRST);
        expect(await provider.getStorage(contract, SLOT_TWO)).to.equal(
            toBeHex(0, 32)
        );

        proxy.changeNotifications(PUSHED_BLOCK, () => undefined);
        const receipt = await node.store(contract, SLOT_ONE, SECOND);
        await fixture.readAtBlock(receipt.blockNumber);
        const proofsBefore = fixture.provenSlotCounts().length;

        expect(await provider.getStorage(contract, SLOT_ONE)).to.equal(SECOND);
        expect(await provider.getStorage(contract, SLOT_TWO)).to.equal(
            toBeHex(0, 32)
        );
        expect(fixture.provenSlotCounts().slice(proofsBefore)).to.deep.equal([
            2
        ]);
        expect(provider.pushedStateCounters).to.deep.include({
            reproofs: 1,
            ...NOTHING_WRONG
        });
        expect(fixture.loggedErrors()).to.deep.equal([]);
        expect(fixture.loggedWarningMessages()).to.deep.equal([]);
    });

    it("keeps a slot a block pushed without its write changed until the interval's proof finds it", async function () {
        fixture = await LightClientProviderFixture.start({ reproofBlocks: 5 });
        const { node, provider } = fixture;
        const contract = await node.deploy(STORE_LOG_AND_READ_CONTRACT);
        await node.store(contract, SLOT_TWO, FIRST);
        const followedAt = await fixture.follow(contract, SLOT_ONE);
        await fixture.readAtBlock(followedAt);
        expect(await provider.getStorage(contract, SLOT_TWO)).to.equal(FIRST);

        // logs slot two only: the block is pushed with its header alone
        const receipt = await node.store(contract, SLOT_TWO, SECOND);
        expect(receipt.blockNumber).to.be.below(followedAt + 4);
        await fixture.pushedThrough(followedAt + 4);
        await fixture.readAtBlock(followedAt + 4);
        const proofsBefore = fixture.provenSlotCounts().length;

        expect(await provider.getStorage(contract, SLOT_TWO)).to.equal(FIRST);
        expect(
            await node.provider.getStorage(contract, SLOT_TWO, followedAt + 4)
        ).to.equal(SECOND);
        expect(fixture.provenSlotCounts().length).to.equal(proofsBefore);
        expect(provider.pushedStateCounters).to.deep.include({
            reproofs: 0,
            ...NOTHING_WRONG
        });

        await fixture.pushedThrough(followedAt + 5);
        await fixture.readAtBlock(followedAt + 5);

        expect(await provider.getStorage(contract, SLOT_TWO)).to.equal(SECOND);
        expect(fixture.provenSlotCounts().slice(proofsBefore)).to.deep.equal([
            1
        ]);
        expect(provider.pushedStateCounters).to.deep.include({
            reproofs: 1,
            refusedBlocks: 0,
            changedUnpushed: 1
        });
        expect(fixture.loggedWarningMessages()).to.deep.equal([
            CHANGED_UNPUSHED
        ]);
        expect(fixture.loggedErrors()).to.deep.equal([]);
    });

    it("refuses a pushed block whose write is not the proven one and proves the storage itself", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider, proxy } = fixture;
        const contract = await node.deploy(STORE_LOG_AND_READ_CONTRACT);
        await node.store(contract, SLOT_ONE, FIRST);
        const followedAt = await fixture.follow(contract, SLOT_ONE);
        await fixture.readAtBlock(followedAt);
        expect(await provider.getStorage(contract, SLOT_ONE)).to.equal(FIRST);

        proxy.changeNotifications(PUSHED_BLOCK, (params) => {
            const { subscription, result } = params as PushedParams;
            return {
                subscription,
                result: {
                    ...result,
                    writes: result.writes.map(({ slot }) => ({
                        slot,
                        value: toBeHex(0xdead, 32)
                    }))
                }
            };
        });
        const receipt = await node.store(contract, SLOT_ONE, SECOND);
        await waitFor(() => provider.pushedStateCounters.refusedBlocks === 1);
        await fixture.readAtBlock(receipt.blockNumber);
        const proofsBefore = fixture.provenSlotCounts().length;

        expect(await provider.getStorage(contract, SLOT_ONE)).to.equal(SECOND);
        expect(fixture.provenSlotCounts().slice(proofsBefore)).to.deep.equal([
            1
        ]);
        expect(provider.pushedStateCounters).to.deep.include({
            reproofs: 1,
            refusedBlocks: 1,
            changedUnpushed: 0
        });
        expect(fixture.loggedErrorMessages()).to.deep.equal([REFUSED_BLOCK]);
        expect(provider.lightClientCounters).to.deep.include({ failed: 0 });
    });

    it("refuses a pushed block that comes without the proof of its writes", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider, proxy } = fixture;
        const contract = await node.deploy(STORE_LOG_AND_READ_CONTRACT);
        await node.store(contract, SLOT_ONE, FIRST);
        const followedAt = await fixture.follow(contract, SLOT_ONE);
        await fixture.readAtBlock(followedAt);
        expect(await provider.getStorage(contract, SLOT_ONE)).to.equal(FIRST);

        proxy.changeNotifications(PUSHED_BLOCK, (params) => {
            const { subscription, result } = params as PushedParams;
            return { subscription, result: { ...result, proofNodes: [] } };
        });
        const receipt = await node.store(contract, SLOT_ONE, SECOND);
        await waitFor(() => provider.pushedStateCounters.refusedBlocks === 1);
        await fixture.readAtBlock(receipt.blockNumber);

        expect(await provider.getStorage(contract, SLOT_ONE)).to.equal(SECOND);
        expect(provider.pushedStateCounters).to.deep.include({
            reproofs: 1,
            refusedBlocks: 1,
            changedUnpushed: 0
        });
        expect(fixture.loggedErrorMessages()).to.deep.equal([REFUSED_BLOCK]);
    });

    it("proves a contract's storage at each block again once its channel is unfollowed", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider, proxy } = fixture;
        const contract = await node.deploy(STORE_LOG_AND_READ_CONTRACT);
        await node.store(contract, SLOT_ONE, FIRST);
        const followedAt = await fixture.follow(contract, SLOT_ONE);
        await fixture.readAtBlock(followedAt);
        expect(await provider.getStorage(contract, SLOT_ONE)).to.equal(FIRST);

        provider.unfollowChannel(contract, SLOT_ONE);
        await waitFor(() => proxy.forwardedCount(UNSUBSCRIBE) === 1);
        const receipt = await node.store(contract, SLOT_ONE, SECOND);
        await fixture.readAtBlock(receipt.blockNumber);
        const proofsBefore = fixture.provenSlotCounts().length;

        expect(await provider.getStorage(contract, SLOT_ONE)).to.equal(SECOND);
        expect(fixture.provenSlotCounts().slice(proofsBefore)).to.deep.equal([
            1
        ]);
        expect(proxy.forwardedCount(SUBSCRIBE)).to.equal(1);
        expect(provider.pushedStateCounters).to.deep.include({
            reproofs: 0,
            ...NOTHING_WRONG
        });
        expect(fixture.loggedErrors()).to.deep.equal([]);
    });

    it("gets the writes of a second channel of the contract once that channel is followed too", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider, proxy } = fixture;
        const contract = await node.deploy(STORE_LOG_AND_READ_CONTRACT);
        await node.store(contract, SLOT_TWO, FIRST);
        await fixture.follow(contract, SLOT_ONE);

        provider.followChannel(contract, SLOT_TWO);
        await waitFor(() => proxy.forwardedCount(SUBSCRIBE) === 2);
        expect(proxy.forwardedCount(UNSUBSCRIBE)).to.equal(1);
        const followedBothAt = await fixture.nextPushedBlock();
        await fixture.readAtBlock(followedBothAt);
        expect(await provider.getStorage(contract, SLOT_TWO)).to.equal(FIRST);

        const receipt = await node.store(contract, SLOT_TWO, SECOND);
        await fixture.pushedThrough(receipt.blockNumber);
        await fixture.readAtBlock(receipt.blockNumber);
        const proofsBefore = fixture.provenSlotCounts().length;

        expect(await provider.getStorage(contract, SLOT_TWO)).to.equal(SECOND);
        expect(fixture.provenSlotCounts().length).to.equal(proofsBefore);
        expect(provider.pushedStateCounters).to.deep.include(NOTHING_WRONG);
        expect(fixture.loggedErrors()).to.deep.equal([]);
    });

    it("subscribes again on a socket that reopened and proves the held storage again", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider, proxy } = fixture;
        const contract = await node.deploy(STORE_LOG_AND_READ_CONTRACT);
        await node.store(contract, SLOT_ONE, FIRST);
        const followedAt = await fixture.follow(contract, SLOT_ONE);
        await fixture.readAtBlock(followedAt);
        expect(await provider.getStorage(contract, SLOT_ONE)).to.equal(FIRST);

        proxy.cut();
        // a block the provider is not pushed
        const receipt = await node.store(contract, SLOT_ONE, SECOND);
        proxy.restore();
        await waitFor(() => proxy.forwardedCount(SUBSCRIBE) === 2);
        const resubscribedAt = await fixture.nextPushedBlock();
        await fixture.readAtBlock(resubscribedAt);
        const proofsBefore = fixture.provenSlotCounts().length;

        expect(resubscribedAt).to.be.above(receipt.blockNumber);
        expect(await provider.getStorage(contract, SLOT_ONE)).to.equal(SECOND);
        expect(fixture.provenSlotCounts().slice(proofsBefore)).to.deep.equal([
            1
        ]);
        expect(provider.pushedStateCounters).to.deep.include({
            reproofs: 1,
            ...NOTHING_WRONG
        });
        expect(fixture.loggedErrors()).to.deep.equal([]);
    });

    it("follows nothing on a node without the light client endpoints", async function () {
        fixture = await LightClientProviderFixture.start({
            withoutEndpoints: true
        });
        const { node, provider, proxy } = fixture;
        const contract = await node.deploy(STORE_LOG_AND_READ_CONTRACT);
        await node.store(contract, SLOT_ONE, FIRST);

        provider.followChannel(contract, SLOT_ONE);

        expect(await provider.getStorage(contract, SLOT_ONE)).to.equal(FIRST);
        expect(proxy.forwardedCount("rpc_methods")).to.equal(1);
        expect(proxy.forwardedCount(SUBSCRIBE)).to.equal(0);
        expect(fixture.loggedErrorMessages()).to.have.length(1);
        expect(provider.pushedStateCounters).to.deep.equal({
            acceptedBlocks: 0,
            reproofs: 0,
            ...NOTHING_WRONG
        });
    });
});
