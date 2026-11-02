import { sleep } from "@/utils";
import { SDK_RPC_DEADLINE_MS } from "@/utils/storageDiff/LearnedBackstop";
import { NOT_RETAINED_ERROR_CODE } from "@/utils/storageDiff/storageDiffWire";
import {
    deployEnvironmentProbe,
    deployMirroredStorage,
    headNumber,
    nodeRequests,
    nodeStateReads,
    serviceRequests,
    withMirrorSession
} from "@test/fixtures/node/RpcMirrorFixture";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { toQuantity, Wallet, ZeroHash } from "ethers";

/** Time is the input: how long a held node reply makes a round trip. */
const NODE_ROUND_TRIP_MS = 400;
/** Time is the input: how long a dropped record's block is given to be mined and pushed. */
const ABSENCE_WINDOW_MS = 500;

describe("MirrorRpcProvider state", function () {
    it("reads a slot written on chain after the block's record arrives without an eth_getStorageAt", async function () {
        await withMirrorSession(async (session) => {
            const { storage } = await deployMirroredStorage(session);
            await (await storage.setValue(5n)).wait();
            expect(await storage.getValue()).to.equal(5n);
            const fetched = serviceRequests(session, "scp_getState").length;

            await (await storage.setValue(7n)).wait();

            expect(await storage.getValue()).to.equal(7n);
            expect(serviceRequests(session, "scp_getState")).to.have.length(
                fetched
            );
            expect(nodeStateReads(session)).to.equal(0);
        });
    });

    it("answers a read from the node when the service fails the state fill", async function () {
        await withMirrorSession(async (session) => {
            const { storage, address } = await deployMirroredStorage(session);
            await (await storage.setValue(5n)).wait();
            // the snapshot is held back, so the read has to ask the service for the field
            const release = session.service.holdNotifications("scp_snapshot");
            session.service.failNextRequest("scp_getState");

            const word = await session.provider.getStorage(address, 0);
            release();

            expect(BigInt(word)).to.equal(5n);
            expect(session.service.failedCount("scp_getState")).to.equal(1);
            expect(nodeRequests(session, "eth_getStorageAt")).to.have.length(1);
        });
    });

    // Mutation (the five cases below): a service request has no time bound,
    // or a read waits for the lock without one, so a silent service holds
    // the read until its socket closes.
    it("answers a read from the node within the SDK deadline when the service never answers its state read", async function () {
        await withMirrorSession(async (session) => {
            const { storage, address } = await deployMirroredStorage(session);
            await (await storage.setValue(5n)).wait();
            // the snapshot is held back, so the read has to ask the service for the field
            const release = session.service.holdNotifications("scp_snapshot");
            session.service.swallowReplies("scp_getState");

            const started = Date.now();
            const word = await session.provider.getStorage(address, 0);
            const elapsed = Date.now() - started;
            release();

            expect(BigInt(word)).to.equal(5n);
            expect(elapsed).to.be.lessThan(SDK_RPC_DEADLINE_MS);
            expect(serviceRequests(session, "scp_getState")).to.have.length(1);
            expect(nodeRequests(session, "eth_getStorageAt")).to.have.length(1);
        });
    });

    it("answers a read of a newly followed account from the node within the SDK deadline when the service never answers the subscribe", async function () {
        await withMirrorSession(async (session) => {
            const first = await deployMirroredStorage(session);
            await first.storage.getValue();
            const second = await deployMirroredStorage(session);
            await (await second.chainStorage.setValue(4n)).wait();
            session.service.swallowReplies("scp_subscribeContractStorage");

            const started = Date.now();
            const word = await session.provider.getStorage(second.address, 0);
            const elapsed = Date.now() - started;

            expect(BigInt(word)).to.equal(4n);
            expect(elapsed).to.be.lessThan(SDK_RPC_DEADLINE_MS);
            expect(nodeRequests(session, "eth_getStorageAt")).to.have.length(1);
        });
    });

    it("answers a first read from the node within the SDK deadline when the service never answers the catch-up that starts following", async function () {
        await withMirrorSession(async (session) => {
            const { chainStorage, address } =
                await deployMirroredStorage(session);
            await (await chainStorage.setValue(3n)).wait();
            session.service.swallowReplies("scp_getContractStorageDiffs");

            const started = Date.now();
            const word = await session.provider.getStorage(address, 0);
            const elapsed = Date.now() - started;

            expect(BigInt(word)).to.equal(3n);
            expect(elapsed).to.be.lessThan(SDK_RPC_DEADLINE_MS);
            expect(
                serviceRequests(session, "scp_getContractStorageDiffs")
            ).to.have.length(1);
            expect(nodeRequests(session, "eth_getStorageAt")).to.have.length(1);
        });
    });

    it("answers eth_blockNumber from the node within the SDK deadline when the service never answers its head", async function () {
        await withMirrorSession(async (session) => {
            await deployMirroredStorage(session);
            session.service.swallowReplies("scp_getHead");

            const started = Date.now();
            const number = await session.provider.send("eth_blockNumber", []);
            const elapsed = Date.now() - started;

            expect(Number(number)).to.equal(await headNumber(session));
            expect(elapsed).to.be.lessThan(SDK_RPC_DEADLINE_MS);
            expect(serviceRequests(session, "scp_getHead")).to.have.length(1);
            expect(nodeRequests(session, "eth_blockNumber")).to.have.length(1);
        });
    });

    it("answers two concurrent reads from the node within the SDK deadline when the service goes silent", async function () {
        await withMirrorSession(async (session) => {
            const { storage } = await deployMirroredStorage(session);
            await storage.getValue();
            session.service.blackhole();
            const accounts = [
                Wallet.createRandom().address,
                Wallet.createRandom().address
            ];

            const started = Date.now();
            // the first holds the lock on a request the service never answers;
            // the second waits for the lock
            const balances = await Promise.all(
                accounts.map((account) => session.provider.getBalance(account))
            );
            const elapsed = Date.now() - started;

            expect(balances).to.deep.equal([0n, 0n]);
            expect(elapsed).to.be.lessThan(SDK_RPC_DEADLINE_MS);
            expect(nodeRequests(session, "eth_getBalance")).to.have.length(2);
        });
    });

    // Mutation: a read waits for the lock without a bound, so it waits out
    // the pushed record's catch-up and answers after its own deadline.
    it("answers a read from the node within its deadline while a pushed record's catch-up holds the mirror on a silent service", async function () {
        await withMirrorSession(async (session) => {
            const { storage, chainStorage, address } =
                await deployMirroredStorage(session);
            expect(await storage.getValue()).to.equal(0n);
            // the node answers a forwarded read slowly: a read's deadline leaves it room
            const slowReply = session.node.holdReplies("eth_getStorageAt");
            const forwarded = session.provider.getStorage(address, 0, 1);
            await waitFor(() => slowReply.heldReplies() === 1, 5_000, 20);
            await sleep(NODE_ROUND_TRIP_MS);
            slowReply.release();
            await forwarded;
            // one record is lost, so the next one's parent is missing and the mirror catches up
            session.service.dropNotifications("scp_subscription");
            await (await chainStorage.setValue(6n)).wait();
            await sleep(ABSENCE_WINDOW_MS);
            session.service.stopDroppingNotifications("scp_subscription");
            const catchUps = serviceRequests(
                session,
                "scp_getContractStorageDiffs"
            ).length;
            session.service.swallowReplies("scp_getContractStorageDiffs");
            await (await chainStorage.setValue(7n)).wait();
            await waitFor(
                () =>
                    serviceRequests(session, "scp_getContractStorageDiffs")
                        .length > catchUps,
                5_000,
                20
            );

            const started = Date.now();
            const balance = await session.provider.getBalance(
                Wallet.createRandom().address
            );
            const elapsed = Date.now() - started;

            expect(balance).to.equal(0n);
            // the catch-up may hold the lock for the SDK's whole deadline; the
            // read gives up at its own, which leaves the slow node its room
            expect(elapsed).to.be.lessThan(
                SDK_RPC_DEADLINE_MS - 2 * NODE_ROUND_TRIP_MS
            );
        });
    });

    // Mutation: a failed unsubscribe drops the service connection, and with it the cache.
    it("keeps the service connection and the cache when the service fails to drop a superseded subscription", async function () {
        await withMirrorSession(async (session) => {
            const first = await deployMirroredStorage(session);
            await (await first.chainStorage.setValue(5n)).wait();
            expect(
                BigInt(await session.provider.getStorage(first.address, 0))
            ).to.equal(5n);
            const second = await deployMirroredStorage(session);
            const unsubscribed = serviceRequests(
                session,
                "scp_unsubscribe"
            ).length;
            session.service.errorRequests(
                "scp_unsubscribe",
                -32000,
                "unsubscribe refused"
            );

            // following the second account replaces the subscription
            await session.provider.getStorage(second.address, 0);
            const asked = serviceRequests(session, "scp_getState").length;
            const nodeReads = nodeStateReads(session);

            expect(serviceRequests(session, "scp_unsubscribe")).to.have.length(
                unsubscribed + 1
            );
            expect(
                BigInt(await session.provider.getStorage(first.address, 0))
            ).to.equal(5n);
            expect(serviceRequests(session, "scp_getState")).to.have.length(
                asked
            );
            expect(nodeStateReads(session)).to.equal(nodeReads);
            expect(
                session.warnings.some(({ message }) =>
                    message.includes(
                        "Mirror cannot drop its previous subscription"
                    )
                )
            ).to.equal(true);
        });
    });

    it("sends no scp_getState and no node read for a second read of the same slot", async function () {
        await withMirrorSession(async (session) => {
            const { storage, address } = await deployMirroredStorage(session);
            await (await storage.setValue(5n)).wait();
            await session.provider.getStorage(address, 0);
            const asked = serviceRequests(session, "scp_getState").length;

            await session.provider.getStorage(address, 0);

            expect(serviceRequests(session, "scp_getState")).to.have.length(
                asked
            );
            expect(nodeStateReads(session)).to.equal(0);
        });
    });

    it("reads a slot cleared on chain as zero without an eth_getStorageAt", async function () {
        await withMirrorSession(async (session) => {
            const { storage, address } = await deployMirroredStorage(session);
            await (await storage.setValue(5n)).wait();
            expect(
                BigInt(await session.provider.getStorage(address, 0))
            ).to.equal(5n);
            const asked = serviceRequests(session, "scp_getState").length;

            await (await storage.setValue(0n)).wait();

            expect(await session.provider.getStorage(address, 0)).to.equal(
                ZeroHash
            );
            expect(serviceRequests(session, "scp_getState")).to.have.length(
                asked
            );
            expect(nodeStateReads(session)).to.equal(0);
        });
    });

    it("reads the replacement branch's value after a reorg", async function () {
        await withMirrorSession(async (session) => {
            const { storage } = await deployMirroredStorage(session);
            await (await storage.setValue(5n)).wait();
            expect(await storage.getValue()).to.equal(5n);
            const fetched = serviceRequests(session, "scp_getState").length;
            const snapshot = await session.chain.send("evm_snapshot", []);
            await (await storage.setValue(6n)).wait();
            expect(await storage.getValue()).to.equal(6n);

            await session.chain.send("evm_revert", [snapshot]);
            await (await storage.setValue(9n)).wait();

            expect(await storage.getValue()).to.equal(9n);
            expect(serviceRequests(session, "scp_getState")).to.have.length(
                fetched
            );
            expect(nodeStateReads(session)).to.equal(0);
        });
    });

    it("restores a slot the orphaned block wrote when the replacement block does not write it", async function () {
        await withMirrorSession(async (session) => {
            const { storage } = await deployMirroredStorage(session);
            await (await storage.setValue(5n)).wait();
            expect(await storage.getValue()).to.equal(5n);
            const fetched = serviceRequests(session, "scp_getState").length;
            const snapshot = await session.chain.send("evm_snapshot", []);
            await (await storage.setValue(6n)).wait();
            expect(await storage.getValue()).to.equal(6n);

            await session.chain.send("evm_revert", [snapshot]);
            await session.chain.send("evm_mine", []);

            await waitFor(async () => (await storage.getValue()) === 5n);
            expect(serviceRequests(session, "scp_getState")).to.have.length(
                fetched
            );
            expect(nodeStateReads(session)).to.equal(0);
        });
    });

    it("asks the service for the blocks from the next missing one when a record's parent is not the head", async function () {
        await withMirrorSession(async (session) => {
            const { storage, chainStorage } =
                await deployMirroredStorage(session);
            await (await chainStorage.setValue(5n)).wait();
            expect(await storage.getValue()).to.equal(5n);
            const head = await headNumber(session);
            const sent = session.service.forwardedRequests.length;

            session.service.dropNotifications("scp_subscription");
            await (await chainStorage.setValue(6n)).wait();
            session.service.stopDroppingNotifications("scp_subscription");
            await (await chainStorage.setValue(7n)).wait();

            await waitFor(async () => (await storage.getValue()) === 7n);
            expect(
                session.service.forwardedRequests
                    .slice(sent)
                    .filter(
                        (request) =>
                            request.method === "scp_getContractStorageDiffs"
                    )
                    .map((request) => (request.params as unknown[])[1])
            ).to.deep.equal([toQuantity(head + 1)]);
        });
    });

    it("empties the cache when the service no longer retains the missing blocks, and the next read goes to the service again", async function () {
        await withMirrorSession(
            async (session) => {
                const { storage, chainStorage } =
                    await deployMirroredStorage(session);
                await (await chainStorage.setValue(5n)).wait();
                expect(await storage.getValue()).to.equal(5n);
                const fetched = serviceRequests(session, "scp_getState").length;

                session.service.dropNotifications("scp_subscription");
                await session.chain.send("evm_mine", []);
                await session.chain.send("evm_mine", []);
                session.service.stopDroppingNotifications("scp_subscription");
                await (await storage.setValue(7n)).wait();

                expect(await storage.getValue()).to.equal(7n);
                expect(
                    serviceRequests(session, "scp_getState").length
                ).to.be.greaterThan(fetched);
                expect(nodeStateReads(session)).to.equal(0);
            },
            { retention: 1 }
        );
    });

    it("reads from the node at the head block number only while the service answers that the block is not retained", async function () {
        await withMirrorSession(async (session) => {
            const { storage, chainStorage } =
                await deployMirroredStorage(session);
            await (await chainStorage.setValue(5n)).wait();
            session.service.dropNotifications("scp_snapshot");
            session.service.errorRequests(
                "scp_getState",
                NOT_RETAINED_ERROR_CODE,
                "Block is not retained"
            );
            const head = await headNumber(session);

            expect(await storage.getValue()).to.equal(5n);

            expect(
                nodeRequests(session, "eth_getStorageAt").map(
                    (request) => (request.params as unknown[])[2]
                )
            ).to.deep.equal([toQuantity(head)]);
            expect(
                nodeRequests(session, "eth_getCode").length
            ).to.be.greaterThan(0);
            session.service.stopErroringRequests("scp_getState");
            const fallbackReads = nodeStateReads(session);

            await (await storage.setValue(6n)).wait();
            expect(await storage.getValue()).to.equal(6n);
            expect(nodeStateReads(session)).to.equal(fallbackReads);
        });
    });

    it("keeps the service connection and the cache when the node fails a state read", async function () {
        await withMirrorSession(async (session) => {
            const { storage, chainStorage } =
                await deployMirroredStorage(session);
            await (await chainStorage.setValue(5n)).wait();
            session.service.dropNotifications("scp_snapshot");
            session.service.errorRequests(
                "scp_getState",
                NOT_RETAINED_ERROR_CODE,
                "Block is not retained"
            );
            session.node.errorRequests("eth_getStorageAt", -32000, "node down");

            // the state read fails on the node too, so the mirror cannot
            // answer; the call itself is answered by the node
            expect(await storage.getValue()).to.equal(5n);
            session.service.stopErroringRequests("scp_getState");
            session.node.stopErroringRequests("eth_getStorageAt");
            const subscribes = serviceRequests(
                session,
                "scp_subscribeContractStorage"
            ).length;

            expect(await storage.getValue()).to.equal(5n);

            expect(
                serviceRequests(session, "scp_subscribeContractStorage")
            ).to.have.length(subscribes);
        });
    });

    it("takes the block environment from the service without reading blocks from the node", async function () {
        await withMirrorSession(async (session) => {
            const probe = await deployEnvironmentProbe(session.signer);

            const answer = await session.provider.call({ to: probe });

            expect(answer).to.equal(await session.chain.call({ to: probe }));
            expect(BigInt(answer.slice(0, 66))).to.be.greaterThan(0n);
            expect(nodeRequests(session, "eth_getBlockByHash")).to.have.length(
                0
            );
            expect(
                nodeRequests(session, "eth_getBlockByNumber")
            ).to.have.length(0);
        });
    });
});
