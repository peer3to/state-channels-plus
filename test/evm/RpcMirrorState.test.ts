import { sleep } from "@/utils";
import { SDK_RPC_DEADLINE_MS } from "@/utils/storageDiff/LearnedBackstop";
import { NOT_RETAINED_ERROR_CODE } from "@/utils/storageDiff/storageDiffWire";
import {
    backfillAtService,
    deployEnvironmentProbe,
    deployMirroredStorage,
    headNumber,
    nodeRequests,
    nodeStateReads,
    serviceRequests,
    serviceStateReadsOf,
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
            const { storage, address } = await deployMirroredStorage(session);
            await (await storage.setValue(5n)).wait();
            expect(await storage.getValue()).to.equal(5n);
            const fetched = serviceStateReadsOf(session, address);

            await (await storage.setValue(7n)).wait();

            expect(await storage.getValue()).to.equal(7n);
            expect(serviceStateReadsOf(session, address)).to.equal(fetched);
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

    // Mutation: the snapshot wait is armed with its backstop alone, ignoring
    // what the read spent waiting for the block.
    it("answers a read from the node within the SDK deadline when it waited for a block and then for a snapshot the service never pushes", async function () {
        await withMirrorSession(async (session) => {
            const first = await deployMirroredStorage(session);
            expect(await first.storage.getValue()).to.equal(0n);
            const second = await deployMirroredStorage(session);
            await (await second.chainStorage.setValue(4n)).wait();
            await backfillAtService(session, [second.address]);
            // the runtime listens to blocks; the provider relays what it hears
            await session.provider.on("block", () => undefined);
            const release =
                session.service.holdNotifications("scp_subscription");
            await (await first.chainStorage.setValue(1n)).wait();
            // time is the input: the node's announcement reaches the provider
            await sleep(ABSENCE_WINDOW_MS);
            session.service.dropNotifications("scp_snapshot");

            const started = Date.now();
            const read = session.provider.getStorage(second.address, 0);
            // time is the input: the read spends half its deadline on the block
            await sleep(SDK_RPC_DEADLINE_MS / 2);
            release();
            const word = await read;
            const elapsed = Date.now() - started;

            expect(BigInt(word)).to.equal(4n);
            expect(elapsed).to.be.lessThan(SDK_RPC_DEADLINE_MS);
            expect(nodeRequests(session, "eth_getStorageAt")).to.have.length(1);
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
            const { storage, address } = await deployMirroredStorage(session);
            await (await storage.setValue(5n)).wait();
            expect(await storage.getValue()).to.equal(5n);
            const fetched = serviceStateReadsOf(session, address);
            const snapshot = await session.chain.send("evm_snapshot", []);
            await (await storage.setValue(6n)).wait();
            expect(await storage.getValue()).to.equal(6n);

            await session.chain.send("evm_revert", [snapshot]);
            await (await storage.setValue(9n)).wait();

            expect(await storage.getValue()).to.equal(9n);
            expect(serviceStateReadsOf(session, address)).to.equal(fetched);
            expect(nodeStateReads(session)).to.equal(0);
        });
    });

    it("restores a slot the orphaned block wrote when the replacement block does not write it", async function () {
        await withMirrorSession(async (session) => {
            const { storage, address } = await deployMirroredStorage(session);
            await (await storage.setValue(5n)).wait();
            expect(await storage.getValue()).to.equal(5n);
            const fetched = serviceStateReadsOf(session, address);
            const snapshot = await session.chain.send("evm_snapshot", []);
            await (await storage.setValue(6n)).wait();
            expect(await storage.getValue()).to.equal(6n);

            await session.chain.send("evm_revert", [snapshot]);
            await session.chain.send("evm_mine", []);

            await waitFor(async () => (await storage.getValue()) === 5n);
            expect(serviceStateReadsOf(session, address)).to.equal(fetched);
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

    it("reads from the node at the head block hash only while the service answers that the block is not retained", async function () {
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
            const head = (await session.chain.getBlock("latest"))!;

            expect(await storage.getValue()).to.equal(5n);

            // Mutation: the node is read at the block number -> a reorg could answer another block.
            expect(
                nodeRequests(session, "eth_getStorageAt").map(
                    (request) => (request.params as unknown[])[2]
                )
            ).to.deep.equal([{ blockHash: head.hash }]);
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

    // Mutation: the limit error is a lost connection -> the copy is dropped
    // and the next read of the first contract follows it again.
    it("keeps its copy and the connection when the service refuses a subscribe with its limit error, and the node answers that read", async function () {
        await withMirrorSession(
            async (session) => {
                const [a, b, c] = [
                    await deployMirroredStorage(session),
                    await deployMirroredStorage(session),
                    await deployMirroredStorage(session)
                ];
                await (await a.chainStorage.setValue(5n)).wait();
                await (await c.chainStorage.setValue(7n)).wait();
                expect(
                    BigInt(await session.provider.getStorage(a.address, 0))
                ).to.equal(5n);
                await session.provider.getStorage(b.address, 0);
                const subscribes = serviceRequests(
                    session,
                    "scp_subscribeContractStorage"
                ).length;
                const reads = serviceStateReadsOf(session, a.address);

                // the service watches two accounts, both followed: a third is refused
                const third = BigInt(
                    await session.provider.getStorage(c.address, 0)
                );
                const nodeReads = nodeRequests(
                    session,
                    "eth_getStorageAt"
                ).length;
                const again = BigInt(
                    await session.provider.getStorage(a.address, 0)
                );

                expect(third).to.equal(7n);
                expect(nodeReads).to.equal(1);
                expect(again).to.equal(5n);
                expect(
                    nodeRequests(session, "eth_getStorageAt")
                ).to.have.length(1);
                expect(serviceStateReadsOf(session, a.address)).to.equal(reads);
                // the refused subscribe only: no reconnect follows again
                expect(
                    serviceRequests(session, "scp_subscribeContractStorage")
                ).to.have.length(subscribes + 1);
            },
            { maxWatchedAddresses: 2 }
        );
    });

    // Mutation: an invalid-params answer is a lost connection -> the copy is dropped.
    it("keeps its copy and the connection when the service refuses a subscribe naming more accounts than it allows", async function () {
        await withMirrorSession(
            async (session) => {
                const [a, b, c] = [
                    await deployMirroredStorage(session),
                    await deployMirroredStorage(session),
                    await deployMirroredStorage(session)
                ];
                await (await a.chainStorage.setValue(5n)).wait();
                await session.provider.getStorage(a.address, 0);
                await session.provider.getStorage(b.address, 0);
                const reads = serviceStateReadsOf(session, a.address);

                await session.provider.getStorage(c.address, 0);
                const again = BigInt(
                    await session.provider.getStorage(a.address, 0)
                );

                expect(again).to.equal(5n);
                expect(serviceStateReadsOf(session, a.address)).to.equal(reads);
                expect(
                    nodeRequests(session, "eth_getStorageAt")
                ).to.have.length(1);
            },
            { maxAddressesPerRequest: 2 }
        );
    });

    // Mutation: the followed set is not bounded -> the third subscribe names all three.
    it("stops following the least recently read contract to follow a new one past its bound, and keeps answering the others locally", async function () {
        await withMirrorSession(
            async (session) => {
                const [a, b, c] = [
                    await deployMirroredStorage(session),
                    await deployMirroredStorage(session),
                    await deployMirroredStorage(session)
                ];
                await (await a.chainStorage.setValue(5n)).wait();
                for (const contract of [a, b, c])
                    await session.provider.getStorage(contract.address, 0);
                const subscribed = serviceRequests(
                    session,
                    "scp_subscribeContractStorage"
                ).at(-1)!.params as [string[]];
                const reads = [b, c].map((contract) =>
                    serviceStateReadsOf(session, contract.address)
                );

                await session.provider.getStorage(b.address, 0);
                await session.provider.getStorage(c.address, 0);
                const evicted = BigInt(
                    await session.provider.getStorage(a.address, 0)
                );

                expect(subscribed[0]).to.have.members(
                    [b.address, c.address].map((address) =>
                        address.toLowerCase()
                    )
                );
                expect(
                    [b, c].map((contract) =>
                        serviceStateReadsOf(session, contract.address)
                    )
                ).to.deep.equal(reads);
                expect(evicted).to.equal(5n);
                expect(nodeStateReads(session)).to.equal(0);
            },
            { maxFollowedAccounts: 2 }
        );
    });

    // Mutation: an account without code is followed -> its next read comes
    // from the record, with no state read; one found without code is
    // followed again -> a subscribe for each of its reads.
    it("does not follow an account without code: reads it again at a new head, without subscribing to it", async function () {
        await withMirrorSession(async (session) => {
            const account = Wallet.createRandom().address;
            await (
                await session.signer.sendTransaction({ to: account, value: 1n })
            ).wait();
            expect(await session.provider.getBalance(account)).to.equal(1n);
            const subscribes = serviceRequests(
                session,
                "scp_subscribeContractStorage"
            ).length;
            const reads = serviceStateReadsOf(session, account);

            await (
                await session.signer.sendTransaction({ to: account, value: 2n })
            ).wait();
            const { address } = await deployMirroredStorage(session);
            await session.provider.getStorage(address, 0);
            const balance = await session.provider.getBalance(account);

            expect(balance).to.equal(3n);
            expect(serviceStateReadsOf(session, account)).to.equal(reads + 1);
            const subscribed = serviceRequests(
                session,
                "scp_subscribeContractStorage"
            );
            // the contract's subscribe only, and it names no account without code
            expect(subscribed).to.have.length(subscribes + 1);
            expect((subscribed.at(-1)!.params as [string[]])[0]).to.not.include(
                account.toLowerCase()
            );
            expect(nodeStateReads(session)).to.equal(0);
        });
    });

    // Mutation: a refused catch-up of a pushed record is a lost connection ->
    // the mirror follows again with a new subscribe.
    it("keeps its copy and the connection when the service refuses a pushed record's catch-up, and catches up with a later record", async function () {
        await withMirrorSession(
            async (session) => {
                const { chainStorage, address } =
                    await deployMirroredStorage(session);
                const written = await (await chainStorage.setValue(5n)).wait();
                expect(
                    BigInt(await session.provider.getStorage(address, 0))
                ).to.equal(5n);
                const subscribes = serviceRequests(
                    session,
                    "scp_subscribeContractStorage"
                ).length;
                // a receipts read held at the upstream takes the one request the service answers at once
                const held = session.relay.holdNext(
                    "eth_getBlockReceipts",
                    written!.blockHash
                );
                const receipt = session.provider.getTransactionReceipt(
                    written!.hash
                );
                await held.arrived;

                // a lost push leaves a gap: the next record's catch-up is refused
                session.service.dropNotifications("scp_subscription");
                await (await chainStorage.setValue(6n)).wait();
                session.service.stopDroppingNotifications("scp_subscription");
                await (await chainStorage.setValue(7n)).wait();
                await waitFor(
                    () =>
                        serviceRequests(session, "scp_getContractStorageDiffs")
                            .length > 0,
                    5_000,
                    20
                );
                await sleep(200);
                held.release();
                await receipt;
                await (await chainStorage.setValue(8n)).wait();

                await waitFor(
                    async () =>
                        BigInt(
                            await session.provider.getStorage(address, 0)
                        ) === 8n,
                    5_000,
                    20
                );
                expect(
                    serviceRequests(session, "scp_subscribeContractStorage")
                ).to.have.length(subscribes);
                expect(nodeStateReads(session)).to.equal(0);
            },
            { maxInFlightRequests: 1 }
        );
    });

    // Mutation: a chain precompile's state is read from the service ->
    // the node is not asked.
    it("reads the storage and balance of an address the chain serves with its own precompile from the node", async function () {
        await withMirrorSession(async (session) => {
            // a builtin above the standard precompiles the local EVM runs
            const builtin = "0x" + "00".repeat(18) + "0100";

            await session.provider.getStorage(builtin, 0);
            await session.provider.getBalance(builtin);

            expect(nodeRequests(session, "eth_getStorageAt")).to.have.length(1);
            expect(nodeRequests(session, "eth_getBalance")).to.have.length(1);
            expect(serviceStateReadsOf(session, builtin)).to.equal(0);
        });
    });

    // Mutation: a record whose catch-up does not reach it is left -> the
    // copy stays on the orphaned branch.
    it("reads the replacement branch's value after a reorg replaces the block the copy began following at", async function () {
        await withMirrorSession(async (session) => {
            const { storage, chainStorage } =
                await deployMirroredStorage(session);
            await (await chainStorage.setValue(5n)).wait();
            const checkpoint = await session.chain.send("evm_snapshot", []);
            await (await chainStorage.setValue(6n)).wait();
            // the copy begins following at this block
            expect(await storage.getValue()).to.equal(6n);
            await session.chain.send("anvil_mine", [toQuantity(3)]);

            await session.chain.send("evm_revert", [checkpoint]);
            await (await chainStorage.setValue(9n)).wait();

            await waitFor(
                async () => (await storage.getValue()) === 9n,
                5_000,
                20
            );
            // the copy itself follows the replacement branch: the next read stays local
            const calls = nodeRequests(session, "eth_call").length;
            expect(await storage.getValue()).to.equal(9n);
            expect(nodeRequests(session, "eth_call")).to.have.length(calls);
        });
    });

    // Mutation: a record below the blocks the copy keeps is ignored -> the
    // copy stays on the orphaned branch.
    it("reads the replacement branch's value after a reorg deeper than the blocks the copy keeps", async function () {
        await withMirrorSession(
            async (session) => {
                const { storage, chainStorage } =
                    await deployMirroredStorage(session);
                await (await chainStorage.setValue(5n)).wait();
                expect(await storage.getValue()).to.equal(5n);
                const checkpoint = await session.chain.send("evm_snapshot", []);
                await (await chainStorage.setValue(6n)).wait();
                // more blocks than the 128 the copy keeps for a rollback
                await session.chain.send("anvil_mine", [toQuantity(130)]);
                await (await chainStorage.setValue(7n)).wait();
                // the copy has applied every block up to the write
                await waitFor(
                    async () => (await storage.getValue()) === 7n,
                    10_000,
                    20
                );

                await session.chain.send("evm_revert", [checkpoint]);
                await (await chainStorage.setValue(9n)).wait();

                await waitFor(
                    async () => (await storage.getValue()) === 9n,
                    5_000,
                    20
                );
                // the copy itself follows the replacement branch: the next read stays local
                const calls = nodeRequests(session, "eth_call").length;
                expect(await storage.getValue()).to.equal(9n);
                expect(nodeRequests(session, "eth_call")).to.have.length(calls);
            },
            // the service keeps the whole reorg, so only the copy is outrun
            { retention: 200 }
        );
    });
});
