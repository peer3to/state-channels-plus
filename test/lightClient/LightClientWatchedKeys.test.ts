// @distributed-requires: lightClient
import { LIGHT_CLIENT_METHODS } from "@/evm/p2pRuntime/rpcNodes/lightClient/lightClientWire";
import { contractStorageKey } from "@/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/frontierStateKeys";
import SubstrateHeader from "@/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/SubstrateHeader";
import type { ChecksumAddress } from "@/types/types";
import { sleep } from "@/utils";
import { PARTITION_CONTRACT } from "@test/fixtures/lightClient/LightClientNodeFixture";
import { LightClientProviderFixture } from "@test/fixtures/lightClient/LightClientProviderFixture";
import type { RecordedMessage } from "@test/fixtures/node/RpcNodeProxy";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { getAddress, toBeHex, ZeroHash } from "ethers";

/** Channel ids, which the partition contract logs as its second topic. */
const CHANNEL_A = toBeHex(0xa1, 32);
const CHANNEL_B = toBeHex(0xa2, 32);
const WATCH = LIGHT_CLIENT_METHODS.watch;
const SUBSCRIBE = LIGHT_CLIENT_METHODS.subscribe;
/** The requests a proven read makes of the node without a watch. */
const PROOF_REQUESTS = ["chain_getHeader", "state_getReadProof"];
const FAILED_READ = "Light client failed a read; asking the nodes";
/** Long enough for a request the provider sends on to reach the endpoint's proxy. */
const UNSENT_REQUEST_WAIT_MS = 200;

/** The trie key of `slot` of `contract`, lowercase. */
function slotKey(contract: string, slot: number): string {
    return contractStorageKey(
        getAddress(contract) as ChecksumAddress,
        toBeHex(slot, 32)
    ).toLowerCase();
}

/** The params of every `method` request the proxy forwarded, in order, with their records. */
function requestsOf(
    records: readonly RecordedMessage[],
    method: string
): { params: unknown[]; sequence: number }[] {
    return records
        .filter((record) => record.method === method)
        .map(({ params, sequence }) => ({
            params: params as unknown[],
            sequence
        }));
}

/** The keys a watch request named, lowercase and sorted. */
function watchedKeysOf(params: unknown[]): string[] {
    return (params[1] as string[]).map((key) => key.toLowerCase()).sort();
}

/** The Substrate hash of the newest block pushed through the fixture's proxy. */
function newestPushedHash(fixture: LightClientProviderFixture): string {
    const pushed = fixture.proxy.sentNotifications
        .filter(({ method }) => method === LIGHT_CLIENT_METHODS.notification)
        .map(
            ({ params }) =>
                (params as { result?: { header: never } }).result?.header
        )
        .filter((header) => header !== undefined);
    return new SubstrateHeader(pushed[pushed.length - 1]).hash;
}

/** The node's read proof of `slot` of `contract` at the newest block pushed through the fixture's proxy. */
async function readProofAt(
    fixture: LightClientProviderFixture,
    contract: string,
    slot: number
): Promise<{ at: string; proof: string[] }> {
    const at = newestPushedHash(fixture);
    const { proof } = (await fixture.node.provider.send("state_getReadProof", [
        [slotKey(contract, slot)],
        at
    ])) as { proof: string[] };
    return { at, proof };
}

describe("Light client watched keys", function () {
    let fixture: LightClientProviderFixture | undefined;

    afterEach(async function () {
        await fixture?.stop();
        fixture = undefined;
    });

    it("proves a read of a key no push holds through a watch on the followed contract's subscription and reads it from the pushes after", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider, proxy } = fixture;
        const contract = await node.deploy(PARTITION_CONTRACT);
        const first = await node.readWriteLog(contract, CHANNEL_A, 5, 10, 7);
        await fixture.followContract(contract);
        await fixture.pushedThrough(first.blockNumber);
        const proofsBefore = fixture.forwardedCount(...PROOF_REQUESTS);

        expect(await provider.getStorage(contract, 10)).to.equal(
            toBeHex(7, 32)
        );

        const watches = requestsOf(proxy.forwardedRequests, WATCH);
        expect(watches).to.have.length(1);
        expect(watchedKeysOf(watches[0].params)).to.deep.equal([
            slotKey(contract, 10)
        ]);
        expect(fixture.forwardedCount(...PROOF_REQUESTS)).to.equal(
            proofsBefore
        );
        // the pushes after the watch carry the key: a read of a later value asks nothing
        const second = await node.readWriteLog(contract, CHANNEL_A, 10, 10, 1);
        await fixture.pushedThrough(second.blockNumber);
        const requestsBefore = fixture.forwardedCount(WATCH, ...PROOF_REQUESTS);
        expect(await provider.getStorage(contract, 10)).to.equal(
            toBeHex(8, 32)
        );
        expect(fixture.forwardedCount(WATCH, ...PROOF_REQUESTS)).to.equal(
            requestsBefore
        );
        expect(fixture.forwardedReadCount()).to.equal(0);
        expect(provider.lightClientCounters).to.deep.include({
            fromPushedState: 1,
            withFallbackRead: 1,
            failed: 0
        });
        expect(fixture.loggedErrors()).to.deep.equal([]);
    });

    it("proves a read with a plain read proof at every block where the endpoint does not list the watch", async function () {
        fixture = await LightClientProviderFixture.start({
            withoutWatch: true
        });
        const { node, provider, proxy } = fixture;
        const contract = await node.deploy(PARTITION_CONTRACT);
        await fixture.followContract(contract);
        const first = await node.readWriteLog(contract, CHANNEL_A, 5, 10, 7);
        await fixture.pushedThrough(first.blockNumber);
        const proofsBefore = proxy.forwardedCount("state_getReadProof");

        expect(await provider.getStorage(contract, 10)).to.equal(
            toBeHex(7, 32)
        );
        const second = await node.readWriteLog(contract, CHANNEL_A, 10, 10, 1);
        await fixture.pushedThrough(second.blockNumber);
        expect(await provider.getStorage(contract, 10)).to.equal(
            toBeHex(8, 32)
        );

        expect(proxy.forwardedCount(WATCH)).to.equal(0);
        expect(proxy.forwardedCount("state_getReadProof")).to.equal(
            proofsBefore + 2
        );
        expect(provider.lightClientCounters).to.deep.include({
            withFallbackRead: 2,
            failed: 0
        });
        expect(fixture.loggedErrors()).to.deep.equal([]);
    });

    it("watches the held keys again on the contract's new subscription once its first message arrived, and reads them from its pushes", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider, proxy } = fixture;
        const contract = await node.deploy(PARTITION_CONTRACT);
        await fixture.followContract(contract);
        const first = await node.readWriteLog(contract, CHANNEL_A, 5, 10, 7);
        await fixture.pushedThrough(first.blockNumber);
        expect(await provider.getStorage(contract, 10)).to.equal(
            toBeHex(7, 32)
        );

        // a followed channel changes the contract's topics: a new subscription
        // syncs, and its keys are watched again only once its first message arrived
        const firstMessages = proxy.holdNotifications(
            LIGHT_CLIENT_METHODS.notification
        );
        provider.followChannel(contract, CHANNEL_B);
        await waitFor(() => proxy.forwardedCount(SUBSCRIBE) === 2);
        await sleep(UNSENT_REQUEST_WAIT_MS);
        expect(proxy.forwardedCount(WATCH)).to.equal(1);
        firstMessages.release();
        await waitFor(() => proxy.forwardedCount(WATCH) === 2);
        const second = await node.readWriteLog(contract, CHANNEL_A, 10, 10, 1);
        await fixture.pushedThrough(second.blockNumber);

        const watches = requestsOf(proxy.forwardedRequests, WATCH);
        expect(watches).to.have.length(2);
        const [, again] = watches;
        expect(watchedKeysOf(again.params)).to.deep.equal([
            slotKey(contract, 10)
        ]);
        expect(again.params[2]).to.equal(null);
        const newId = again.params[0];
        expect(newId).to.not.equal(watches[0].params[0]);
        const firstMessage = proxy.sentNotifications.find(
            ({ params }) =>
                (params as { subscription?: unknown }).subscription === newId
        );
        expect(firstMessage?.sequence).to.be.below(again.sequence);
        // the new subscription pushes the key: the read asks nothing
        const requestsBefore = fixture.forwardedCount(WATCH, ...PROOF_REQUESTS);
        expect(await provider.getStorage(contract, 10)).to.equal(
            toBeHex(8, 32)
        );
        expect(fixture.forwardedCount(WATCH, ...PROOF_REQUESTS)).to.equal(
            requestsBefore
        );
        expect(fixture.loggedErrors()).to.deep.equal([]);
        expect(fixture.loggedWarningMessages()).to.deep.equal([]);
    });

    it("warns when a new subscription cannot be asked to watch the kept keys, and the next read watches them again", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider, proxy } = fixture;
        const contract = await node.deploy(PARTITION_CONTRACT);
        await fixture.followContract(contract);
        const first = await node.readWriteLog(contract, CHANNEL_A, 5, 10, 7);
        await fixture.pushedThrough(first.blockNumber);
        expect(await provider.getStorage(contract, 10)).to.equal(
            toBeHex(7, 32)
        );
        proxy.failNextRequest(WATCH);

        await fixture.follow(contract, CHANNEL_B);
        await waitFor(() => fixture!.loggedWarningMessages().length > 0);

        expect(fixture.loggedWarningMessages()).to.deep.equal([
            "Light client could not watch the held keys on a new subscription; reads watch them again"
        ]);
        expect(fixture.loggedErrors()).to.deep.equal([]);
        const second = await node.readWriteLog(contract, CHANNEL_A, 10, 10, 1);
        await fixture.pushedThrough(second.blockNumber);
        expect(await provider.getStorage(contract, 10)).to.equal(
            toBeHex(8, 32)
        );
        expect(proxy.forwardedCount(WATCH)).to.equal(3);
        expect(provider.lightClientCounters).to.deep.include({
            withFallbackRead: 2,
            failed: 0
        });
    });

    it("keeps watching a refused key at every read while the endpoint is at its cap, and answers it right", async function () {
        fixture = await LightClientProviderFixture.start({ maxWatchedKeys: 1 });
        const { node, provider, proxy } = fixture;
        const contract = await node.deploy(PARTITION_CONTRACT);
        await fixture.followContract(contract);
        const first = await node.readWriteLog(contract, CHANNEL_A, 5, 10, 7);
        await fixture.pushedThrough(first.blockNumber);
        // slot 10 takes the one place, slot 11 is refused
        expect(await provider.getStorage(contract, 10)).to.equal(
            toBeHex(7, 32)
        );
        expect(await provider.getStorage(contract, 11)).to.equal(
            toBeHex(0, 32)
        );
        expect(proxy.forwardedCount(WATCH)).to.equal(2);

        const second = await node.readWriteLog(contract, CHANNEL_A, 5, 11, 4);
        await fixture.pushedThrough(second.blockNumber);
        expect(await provider.getStorage(contract, 11)).to.equal(
            toBeHex(4, 32)
        );
        expect(await provider.getStorage(contract, 10)).to.equal(
            toBeHex(7, 32)
        );

        // the refused key was proven again, the watched one came with the push
        const watches = requestsOf(proxy.forwardedRequests, WATCH);
        expect(
            watches.map(({ params }) => watchedKeysOf(params))
        ).to.deep.equal([
            [slotKey(contract, 10)],
            [slotKey(contract, 11)],
            [slotKey(contract, 11)]
        ]);
        expect(provider.lightClientCounters).to.deep.include({
            fromPushedState: 1,
            withFallbackRead: 3,
            failed: 0
        });
        // a new subscription watches again only the key the endpoint took
        await fixture.follow(contract, CHANNEL_B);
        await waitFor(() => proxy.forwardedCount(WATCH) === 4);
        const again = requestsOf(proxy.forwardedRequests, WATCH)[3];
        expect(watchedKeysOf(again.params)).to.deep.equal([
            slotKey(contract, 10)
        ]);
        expect(fixture.loggedErrors()).to.deep.equal([]);
    });

    it("proves a read with a plain read proof while the followed contract's subscription has had no message", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider, proxy } = fixture;
        const contract = await node.deploy(PARTITION_CONTRACT);
        await node.readWriteLog(contract, CHANNEL_A, 5, 10, 7);
        // the node's messages never reach the provider
        proxy.changeNotifications(
            LIGHT_CLIENT_METHODS.notification,
            () => undefined
        );
        provider.followContract(contract);
        await waitFor(() => proxy.forwardedCount(SUBSCRIBE) === 1);
        const proofsBefore = proxy.forwardedCount("state_getReadProof");

        expect(await provider.getStorage(contract, 10)).to.equal(
            toBeHex(7, 32)
        );

        expect(proxy.forwardedCount(WATCH)).to.equal(0);
        expect(proxy.forwardedCount("state_getReadProof")).to.equal(
            proofsBefore + 1
        );
        expect(fixture.loggedErrors()).to.deep.equal([]);
    });

    it("refuses a watch answered at another block than the read's, counts the failed read and answers through the endpoint", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider, proxy } = fixture;
        const contract = await node.deploy(PARTITION_CONTRACT);
        await fixture.followContract(contract);
        const first = await node.readWriteLog(contract, CHANNEL_A, 5, 10, 7);
        await fixture.pushedThrough(first.blockNumber);
        // a proof that decides the key, said to be of another block
        const { proof } = await readProofAt(fixture, contract, 10);
        proxy.answerNextRequest(WATCH, {
            at: ZeroHash,
            proof,
            watched: []
        });

        expect(await provider.getStorage(contract, 10)).to.equal(
            toBeHex(7, 32)
        );

        expect(provider.lightClientCounters).to.deep.include({ failed: 1 });
        expect(fixture.loggedErrorMessages()).to.deep.equal([FAILED_READ]);
        expect(fixture.loggedErrors()[0].meta[0]).to.deep.include({
            reason: "proof rejected"
        });
        // a later read watches again, at the node
        expect(await provider.getStorage(contract, 10)).to.equal(
            toBeHex(7, 32)
        );
        expect(proxy.forwardedCount(WATCH)).to.equal(2);
        expect(provider.lightClientCounters).to.deep.include({
            withFallbackRead: 1,
            failed: 1
        });
    });

    it("refuses a watch that names a key the read did not ask, counts the failed read and answers through the endpoint", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider, proxy } = fixture;
        const contract = await node.deploy(PARTITION_CONTRACT);
        await fixture.followContract(contract);
        const first = await node.readWriteLog(contract, CHANNEL_A, 5, 10, 7);
        await fixture.pushedThrough(first.blockNumber);
        // a proof that decides the key, naming a key not asked as taken
        const { at, proof } = await readProofAt(fixture, contract, 10);
        proxy.answerNextRequest(WATCH, {
            at,
            proof,
            watched: [slotKey(contract, 11)]
        });

        expect(await provider.getStorage(contract, 10)).to.equal(
            toBeHex(7, 32)
        );

        expect(provider.lightClientCounters).to.deep.include({ failed: 1 });
        expect(fixture.loggedErrorMessages()).to.deep.equal([FAILED_READ]);
        expect(fixture.loggedErrors()[0].meta[0]).to.deep.include({
            reason: "proof rejected"
        });
    });

    it("refuses a watch whose proof does not decide the asked key, counts the failed read and answers through the endpoint", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider, proxy } = fixture;
        const contract = await node.deploy(PARTITION_CONTRACT);
        await fixture.followContract(contract);
        const first = await node.readWriteLog(contract, CHANNEL_A, 5, 10, 7);
        await fixture.pushedThrough(first.blockNumber);
        proxy.answerNextRequest(WATCH, {
            at: newestPushedHash(fixture),
            proof: [],
            watched: [slotKey(contract, 10)]
        });

        expect(await provider.getStorage(contract, 10)).to.equal(
            toBeHex(7, 32)
        );

        expect(provider.lightClientCounters).to.deep.include({ failed: 1 });
        expect(fixture.loggedErrorMessages()).to.deep.equal([FAILED_READ]);
        expect(fixture.loggedErrors()[0].meta[0]).to.deep.include({
            reason: "proof rejected"
        });
    });

    it("keeps the followed contract's subscription without topics before a channel is followed and after the last one is unfollowed", async function () {
        fixture = await LightClientProviderFixture.start();
        const { node, provider, proxy } = fixture;
        const contract = (await node.deploy(PARTITION_CONTRACT)).toLowerCase();
        await fixture.followContract(contract);
        await fixture.follow(contract, CHANNEL_A);
        provider.unfollowChannel(contract, CHANNEL_A);
        const unfollowed = await fixture.nextPushedBlock();
        await fixture.pushedThrough(unfollowed + 1);

        const subscribes = requestsOf(proxy.forwardedRequests, SUBSCRIBE).map(
            ({ params }) => params[0]
        );
        expect(subscribes).to.deep.equal([
            { address: contract, topics: [] },
            { address: contract, topics: [CHANNEL_A] },
            { address: contract, topics: [] }
        ]);
        expect(fixture.loggedErrors()).to.deep.equal([]);
    });

    it("answers watched reads as the endpoint does at their blocks, with the reads compared", async function () {
        fixture = await LightClientProviderFixture.start({
            comparesReads: true
        });
        const { node, provider } = fixture;
        const contract = await node.deploy(PARTITION_CONTRACT);
        await fixture.followContract(contract);
        for (const add of [7, 1, 2]) {
            const written = await node.readWriteLog(
                contract,
                CHANNEL_A,
                5,
                10,
                add
            );
            await fixture.pushedThrough(written.blockNumber);
            await provider.getStorage(contract, 10);
            await provider.getStorage(contract, 5);
        }

        expect(provider.readComparisons).to.deep.equal({
            matched: 6,
            differed: 0,
            notCompared: 0
        });
        expect(provider.lightClientCounters).to.deep.include({
            withFallbackRead: 2,
            fromPushedState: 4,
            failed: 0
        });
        expect(fixture.loggedErrors()).to.deep.equal([]);
    });
});
