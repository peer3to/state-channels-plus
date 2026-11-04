import { sleep } from "@/utils";
import { SDK_RPC_DEADLINE_MS } from "@/utils/storageDiff/LearnedBackstop";
import {
    backfillAtService,
    deployMirroredStorage,
    headNumber,
    nodeRequests,
    serviceRequests,
    withMirrorSession,
    type MirrorSession
} from "@test/fixtures/node/RpcMirrorFixture";
import {
    deployLogEmitter,
    emitValue
} from "@test/fixtures/node/StorageDiffContracts";
import { recordUnhandledRejections } from "@test/fixtures/UnhandledRejectionRecorder";
import { waitFor } from "@test/utils/waitFor";
import type { SimpleNumberStorage } from "@typechain-types";
import { expect } from "chai";
import { toQuantity, ZeroAddress } from "ethers";

/** Time is the input: how long a read that must wait is watched for. */
const ABSENCE_WINDOW_MS = 500;
/** Time is the input: how long a held node reply makes a round trip. */
const NODE_ROUND_TRIP_MS = 400;

/** Time is the input: how long the node takes over a log query; four of it pass the deadline. */
const SLOW_LOG_QUERY_MS = 1_000;

/** Time is the input: how long after its announcement the slowest taught block reaches the copy. */
const SLOW_RECORD_MS = 100;

/** Time is the input: how old an orphaned block's announcement is when the copy reaches its height again. */
const ORPHAN_AGE_MS = 1_500;

/**
 * Lets the mirror learn how long records take: blocks a node announces reach
 * the copy a few milliseconds later, and one of them SLOW_RECORD_MS later,
 * each arrival a sample for the backstop.
 */
async function teachBackstop(
    session: MirrorSession,
    chainStorage: SimpleNumberStorage
): Promise<void> {
    await session.provider.getBalance(ZeroAddress);
    await session.provider.on("block", () => undefined);
    for (let value = 1n; value <= 3n; value++)
        await (await chainStorage.setValue(value)).wait();
    const slow = session.relay.holdNext("eth_getBlockByNumber", "latest");
    await (await chainStorage.setValue(4n)).wait();
    await slow.arrived;
    await sleep(SLOW_RECORD_MS);
    slow.release();
}

/** Waits until `read` returns `value` without asking the node `method`. */
async function waitForLocalAnswer(
    session: MirrorSession,
    method: string,
    read: () => Promise<bigint>,
    value: bigint
): Promise<void> {
    await waitFor(
        async () => {
            const asked = nodeRequests(session, method).length;
            return (
                (await read()) === value &&
                nodeRequests(session, method).length === asked
            );
        },
        5_000,
        20
    );
}

describe("MirrorRpcProvider freshness", function () {
    it("holds a call issued after the peer's own transaction is mined until the mirror has that block", async function () {
        await withMirrorSession(async (session) => {
            const { storage } = await deployMirroredStorage(session);
            expect(await storage.getValue()).to.equal(0n);
            const release =
                session.service.holdNotifications("scp_subscription");

            const sent = await storage.setValue(42n);
            await sent.wait();
            let settled = false;
            const read = storage.getValue().finally(() => (settled = true));
            await sleep(ABSENCE_WINDOW_MS);
            expect(settled, "the read waits for the block's record").to.equal(
                false
            );
            release();

            expect(await read).to.equal(42n);
            expect(nodeRequests(session, "eth_call")).to.have.length(0);
        });
    });

    it("holds a call until the mirror reaches a block a node that offers only newBlockHeaders announced", async function () {
        await withMirrorSession(async (session) => {
            // the node's head subscriptions are Asset Hub eth-rpc's
            session.node.offerOnlyNewBlockHeaders();
            const { storage, chainStorage } =
                await deployMirroredStorage(session);
            expect(await storage.getValue()).to.equal(0n);
            // the runtime listens to blocks; the provider relays what it hears
            await session.provider.on("block", () => undefined);
            const release =
                session.service.holdNotifications("scp_subscription");

            await (await chainStorage.setValue(3n)).wait();
            // time is the input: the node's announcement reaches the provider
            await sleep(ABSENCE_WINDOW_MS);
            let settled = false;
            const read = storage.getValue().finally(() => (settled = true));
            await sleep(ABSENCE_WINDOW_MS);
            // Mutation: no newBlockHeaders after the refusal, nothing announced, the read returns 0n
            expect(settled, "the read waits for the announced block").to.equal(
                false
            );
            release();

            expect(await read).to.equal(3n);
            expect(
                nodeRequests(session, "eth_subscribe").map(
                    (request) => (request.params as unknown[])[0]
                )
            ).to.include("newBlockHeaders");
        });
    });

    it("holds a call until the mirror reaches a block the node announced", async function () {
        await withMirrorSession(async (session) => {
            const { storage, chainStorage } =
                await deployMirroredStorage(session);
            expect(await storage.getValue()).to.equal(0n);
            // the runtime listens to blocks; the provider relays what it hears
            await session.provider.on("block", () => undefined);
            const release =
                session.service.holdNotifications("scp_subscription");

            await (await chainStorage.setValue(3n)).wait();
            // time is the input: the node's announcement reaches the provider
            await sleep(ABSENCE_WINDOW_MS);
            let settled = false;
            const read = storage.getValue().finally(() => (settled = true));
            await sleep(ABSENCE_WINDOW_MS);
            expect(settled, "the read waits for the announced block").to.equal(
                false
            );
            release();

            expect(await read).to.equal(3n);
            expect(nodeRequests(session, "eth_call")).to.have.length(0);
        });
    });

    it("holds a call until the mirror reaches a block the node announced, with no block listener of its own", async function () {
        await withMirrorSession(async (session) => {
            const { storage, chainStorage } =
                await deployMirroredStorage(session);
            expect(await storage.getValue()).to.equal(0n);
            const release =
                session.service.holdNotifications("scp_subscription");

            await (await chainStorage.setValue(3n)).wait();
            // time is the input: the node's announcement reaches the provider
            await sleep(ABSENCE_WINDOW_MS);
            let settled = false;
            const read = storage.getValue().finally(() => (settled = true));
            await sleep(ABSENCE_WINDOW_MS);
            // Mutation: no head subscription of the provider's own, the read answers from the older copy
            expect(settled, "the read waits for the announced block").to.equal(
                false
            );
            release();

            expect(await read).to.equal(3n);
            expect(nodeRequests(session, "eth_call")).to.have.length(0);
        });
    });

    it("keeps answering reads from the mirror when its only node refuses every subscription, with one warning and no unhandled rejection", async function () {
        const recorder = recordUnhandledRejections();
        try {
            await withMirrorSession(
                async (session) => {
                    const { storage, chainStorage } =
                        await deployMirroredStorage(session);
                    await (await chainStorage.setValue(7n)).wait();

                    await waitFor(
                        async () => (await storage.getValue()) === 7n
                    );
                    const refusals = session.warnings.filter(
                        (warning) =>
                            warning.message ===
                            "RPC node refused a subscription"
                    );

                    expect(nodeRequests(session, "eth_call")).to.have.length(0);
                    // the provider's own head subscription, refused once
                    expect(refusals).to.have.length(1);
                    // Mutation: the refusal rethrown, as ethers leaves it unhandled
                    expect(await recorder.settled()).to.deep.equal([]);
                },
                {
                    prepareNode: (node) =>
                        node.errorRequests(
                            "eth_subscribe",
                            -32602,
                            "Invalid params"
                        )
                }
            );
        } finally {
            recorder.stop();
        }
    });

    // Mutation: a backstop seeded with a short default ends the first wait early.
    it("waits the whole cap, then asks the node, for an announced block before any record has reached the copy", async function () {
        await withMirrorSession(async (session) => {
            const { storage, chainStorage } =
                await deployMirroredStorage(session);
            expect(await storage.getValue()).to.equal(0n);
            // the runtime listens to blocks; the provider relays what it hears
            await session.provider.on("block", () => undefined);
            const release =
                session.service.holdNotifications("scp_subscription");
            await (await chainStorage.setValue(3n)).wait();
            // time is the input: the node's announcement reaches the provider
            await sleep(ABSENCE_WINDOW_MS);

            let settled = false;
            const started = Date.now();
            const read = storage.getValue().finally(() => (settled = true));
            await sleep(SDK_RPC_DEADLINE_MS / 2);
            expect(settled, "no arrival yet: the wait is the cap").to.equal(
                false
            );
            const value = await read;
            const elapsed = Date.now() - started;
            release();

            expect(value).to.equal(3n);
            expect(elapsed).to.be.lessThan(SDK_RPC_DEADLINE_MS);
            expect(nodeRequests(session, "eth_call")).to.have.length(1);
        });
    });

    it("answers with the node's value, not the older head's, when a block never reaches the copy within the learned backstop", async function () {
        await withMirrorSession(async (session) => {
            const { storage, chainStorage } =
                await deployMirroredStorage(session);
            await teachBackstop(session, chainStorage);
            await (await storage.setValue(2n)).wait();
            expect(await storage.getValue()).to.equal(2n);
            const release =
                session.service.holdNotifications("scp_subscription");

            await (await storage.setValue(7n)).wait();
            const started = Date.now();
            const value = await storage.getValue();
            const elapsed = Date.now() - started;

            expect(value, "the node's value, not the copy's older 2").to.equal(
                7n
            );
            // the wait is the learned bound, not the cap
            expect(elapsed).to.be.greaterThan(SLOW_RECORD_MS);
            // Mutation: a backstop that stays at the cap makes the read wait
            // the whole deadline.
            expect(elapsed).to.be.lessThan((SDK_RPC_DEADLINE_MS * 2) / 3);
            expect(nodeRequests(session, "eth_call")).to.have.length(1);

            // the wait is not repeated for every read: the node answers at once
            const repeated = Date.now();
            expect(await storage.getValue()).to.equal(7n);
            expect(nodeRequests(session, "eth_call")).to.have.length(2);
            // Mutation: a flag that does not stay set repeats the whole wait.
            expect(Date.now() - repeated).to.be.lessThan(elapsed / 2);

            // once the record arrives the copy answers again
            release();
            await waitFor(async () => {
                const asked = nodeRequests(session, "eth_call").length;
                await storage.getValue();
                return nodeRequests(session, "eth_call").length === asked;
            }, 5_000);
        });
    });

    it("asks the node at once when the service says its tracing of the awaited block failed", async function () {
        await withMirrorSession(async (session) => {
            const { storage, chainStorage } =
                await deployMirroredStorage(session);
            expect(await storage.getValue()).to.equal(0n);
            await session.provider.on("block", () => undefined);
            session.relay.failNext("debug_traceBlockByNumber", 1);
            const held = session.relay.holdNext(
                "eth_getBlockByNumber",
                "latest"
            );

            await (await chainStorage.setValue(3n)).wait();
            await held.arrived;
            // time is the input: the node's announcement reaches the provider
            await sleep(ABSENCE_WINDOW_MS);
            const read = storage.getValue();
            await sleep(50);
            const released = Date.now();
            held.release();
            const value = await read;

            // the retry would deliver the record after its backoff: the notice came first
            expect(value).to.equal(3n);
            // Mutation: ignoring the service's block-delay notice leaves the
            // wait to the retry and the backstop, past this bound.
            expect(Date.now() - released).to.be.lessThan(
                SDK_RPC_DEADLINE_MS / 2
            );
            expect(nodeRequests(session, "eth_call")).to.have.length(1);
        });
    });

    it("asks the service once when a wait for a block starts, so a service whose upstream is behind sends the reads to the node at once", async function () {
        await withMirrorSession(async (session) => {
            const { storage, chainStorage } =
                await deployMirroredStorage(session);
            expect(await storage.getValue()).to.equal(0n);
            await session.provider.on("block", () => undefined);
            const older = await headNumber(session);
            const held = session.relay.holdNext(
                "eth_getBlockByNumber",
                "latest"
            );

            await (await chainStorage.setValue(3n)).wait();
            await held.arrived;
            // time is the input: the node's announcement reaches the provider
            await sleep(ABSENCE_WINDOW_MS);
            // the service's upstream answers as if it had not reached the block
            session.relay.tamper("eth_blockNumber", () => toQuantity(older));
            const probes = serviceRequests(session, "scp_getHead").length;
            const started = Date.now();
            // three reads wait for the same block, and no read names it to the service
            const values = await Promise.all([
                storage.getValue(),
                storage.getValue(),
                storage.getValue()
            ]);

            expect(values).to.deep.equal([3n, 3n, 3n]);
            expect(Date.now() - started).to.be.lessThan(
                SDK_RPC_DEADLINE_MS / 2
            );
            expect(serviceRequests(session, "scp_getHead")).to.have.length(
                probes + 1
            );
            expect(nodeRequests(session, "eth_call")).to.have.length(3);
            held.release();
            // once the copy holds the block the next wait probes again
            await waitFor(async () => {
                const asked = nodeRequests(session, "eth_call").length;
                await storage.getValue();
                return nodeRequests(session, "eth_call").length === asked;
            }, 5_000);
            const heldAgain = session.relay.holdNext(
                "eth_getBlockByNumber",
                "latest"
            );
            await (await chainStorage.setValue(4n)).wait();
            await heldAgain.arrived;
            await sleep(ABSENCE_WINDOW_MS);
            const secondStarted = Date.now();
            expect(await storage.getValue()).to.equal(4n);
            expect(Date.now() - secondStarted).to.be.lessThan(
                SDK_RPC_DEADLINE_MS / 2
            );
            expect(serviceRequests(session, "scp_getHead")).to.have.length(
                probes + 2
            );
            heldAgain.release();
        });
    });

    it("asks the service again when a later wait is for the same block number, as after the node rolled back below the block the copy had reached", async function () {
        await withMirrorSession(async (session) => {
            const { storage } = await deployMirroredStorage(session);
            expect(await storage.getValue()).to.equal(0n);
            await session.provider.on("block", () => undefined);
            // held, so no arrival teaches the backstop: the first wait lasts until its record comes
            const releaseNode =
                session.node.holdNotifications("eth_subscription");
            await session.chain.send("evm_mine", []);
            // time is the input: the mined block reaches the copy
            await sleep(ABSENCE_WINDOW_MS);
            const release =
                session.service.holdNotifications("scp_subscription");

            // the receipt of the provider's own transaction names the block the next read waits for
            await (await storage.setValue(3n)).wait();
            const probes = serviceRequests(session, "scp_getHead").length;
            const first = storage.getValue();
            await waitFor(
                () =>
                    serviceRequests(session, "scp_getHead").length ===
                    probes + 1,
                5_000,
                20
            );
            release();
            expect(await first).to.equal(3n);
            // the node's announcements name the block a read waits for from here
            releaseNode();

            // the node rolls back below the block the first read waited for
            await session.chain.send("anvil_rollback", [2]);
            await session.chain.send("evm_mine", []);
            // time is the input: the new head reaches the copy
            await sleep(ABSENCE_WINDOW_MS);
            const releaseAgain =
                session.service.holdNotifications("scp_subscription");
            // the replacement branch reaches the same block number again
            await session.chain.send("evm_mine", []);
            // time is the input: the node's announcement reaches the provider
            await sleep(ABSENCE_WINDOW_MS);
            const probesBefore = serviceRequests(session, "scp_getHead").length;
            const second = storage.getValue();
            // time is the input: how long a probe the wait would send is watched for
            await sleep(ABSENCE_WINDOW_MS);

            expect(serviceRequests(session, "scp_getHead")).to.have.length(
                probesBefore + 1
            );
            releaseAgain();
            // the replacement branch does not hold the orphaned write
            expect(await second).to.equal(0n);
        });
    });

    it("shortens the longest wait as the node's round trips grow, and a read that waits the whole cap still gets the node's answer inside the deadline", async function () {
        await withMirrorSession(async (session) => {
            const { storage, address } = await deployMirroredStorage(session);
            expect(await storage.getValue()).to.equal(0n);

            // the node answers a forwarded read slowly: that is a round trip learned
            const slowReply = session.node.holdReplies("eth_getStorageAt");
            const forwarded = session.provider.getStorage(address, 0, 1);
            await waitFor(() => slowReply.heldReplies() === 1, 5_000, 20);
            // time is the input: how long the node takes to answer
            await sleep(NODE_ROUND_TRIP_MS);
            slowReply.release();
            await forwarded;

            // the service stays silent, so the read waits for the whole cap
            const release =
                session.service.holdNotifications("scp_subscription");
            await (await storage.setValue(7n)).wait();
            const nodeReply = session.node.holdReplies("eth_call");
            const started = Date.now();
            const read = storage.getValue();
            await waitFor(() => nodeReply.heldReplies() === 1, 10_000, 20);
            const waited = Date.now() - started;
            await sleep(NODE_ROUND_TRIP_MS);
            nodeReply.release();
            const value = await read;

            expect(value, "the node's value, not the copy's older 0").to.equal(
                7n
            );
            // the wait was not cut short, and the answer still came inside the deadline
            expect(waited).to.be.greaterThan(1_000);
            // Mutation: a cap that ignores the node's round trips lets the
            // wait run the whole deadline, and the node's answer comes late.
            expect(Date.now() - started).to.be.lessThan(SDK_RPC_DEADLINE_MS);
            release();
        });
    });

    // Mutation: every forwarded request teaches the round trip, so one slow
    // log query cuts the longest wait to nothing.
    it("keeps the longest wait when the node answers a log query slowly", async function () {
        await withMirrorSession(async (session) => {
            const { storage, chainStorage } =
                await deployMirroredStorage(session);
            expect(await storage.getValue()).to.equal(0n);
            // a log query no wait falls back to, answered slowly
            const slowLogs = session.node.holdReplies("eth_getLogs");
            const logs = session.provider.send("eth_getLogs", [
                { fromBlock: "0x0", toBlock: "latest" }
            ]);
            await waitFor(() => slowLogs.heldReplies() === 1, 5_000, 20);
            await sleep(SLOW_LOG_QUERY_MS);
            slowLogs.release();
            await logs;
            // the runtime listens to blocks; the service stays silent about the next one
            await session.provider.on("block", () => undefined);
            const release =
                session.service.holdNotifications("scp_subscription");
            await (await chainStorage.setValue(3n)).wait();
            // time is the input: the node's announcement reaches the provider
            await sleep(ABSENCE_WINDOW_MS);

            let settled = false;
            const read = storage.getValue().finally(() => (settled = true));
            await sleep(ABSENCE_WINDOW_MS);
            expect(settled, "the read still waits for the block").to.equal(
                false
            );
            release();

            expect(await read).to.equal(3n);
            expect(nodeRequests(session, "eth_call")).to.have.length(0);
        });
    });

    it("asks the node at once when the service says a snapshot it promised as ready is delayed", async function () {
        await withMirrorSession(
            async (session) => {
                const { chainStorage, address } =
                    await deployMirroredStorage(session);
                await (await chainStorage.setValue(5n)).wait();
                await backfillAtService(session, [address]);
                await session.chain.send("anvil_mine", [3]);
                session.service.dropNotifications("scp_snapshot");
                // the node's announcements of the reorganized blocks would end the wait first
                const releaseNode =
                    session.node.holdNotifications("eth_subscription");

                // no earlier read taught the snapshot backstop: it stays at its cap
                const started = Date.now();
                const read = session.provider.getStorage(address, 0);
                await sleep(ABSENCE_WINDOW_MS);
                // a reorganization of the whole retained window clears the service's cache
                await session.chain.send("anvil_reorg", [2, []]);
                await session.chain.send("evm_mine", []);
                const word = await read;
                releaseNode();

                expect(BigInt(word)).to.equal(5n);
                // Mutation: ignoring the snapshot-delayed notice leaves the read
                // waiting for the snapshot backstop, past this bound.
                expect(Date.now() - started).to.be.lessThan(
                    SDK_RPC_DEADLINE_MS / 2
                );
            },
            { retention: 2 }
        );
    });

    it("asks the node at once when the service connection drops while a call waits for a block", async function () {
        await withMirrorSession(async (session) => {
            const { storage } = await deployMirroredStorage(session);
            expect(await storage.getValue()).to.equal(0n);
            session.service.holdNotifications("scp_subscription");

            await (await storage.setValue(42n)).wait();
            const started = Date.now();
            const read = storage.getValue();
            await sleep(ABSENCE_WINDOW_MS / 2);
            session.service.cut();
            const value = await read;

            expect(value).to.equal(42n);
            expect(Date.now() - started).to.be.lessThan(
                SDK_RPC_DEADLINE_MS / 2
            );
            expect(nodeRequests(session, "eth_call")).to.have.length(1);
        });
    });

    it("asks the node at once when a node announces a later block while the copy still lacks the one before", async function () {
        await withMirrorSession(async (session) => {
            const { storage, chainStorage } =
                await deployMirroredStorage(session);
            expect(await storage.getValue()).to.equal(0n);
            await session.provider.on("block", () => undefined);
            const release =
                session.service.holdNotifications("scp_subscription");

            await (await chainStorage.setValue(3n)).wait();
            // time is the input: the node's announcement reaches the provider
            await sleep(ABSENCE_WINDOW_MS);
            const started = Date.now();
            const read = storage.getValue();
            await sleep(50);
            await (await chainStorage.setValue(4n)).wait();
            const value = await read;

            expect(value).to.equal(4n);
            expect(Date.now() - started).to.be.lessThan(
                SDK_RPC_DEADLINE_MS / 2
            );
            expect(nodeRequests(session, "eth_call")).to.have.length(1);
            release();
        });
    });

    it("asks the node for the latest block while the service is behind a block the node announced", async function () {
        await withMirrorSession(async (session) => {
            await session.rpcNode.watchSockets((socket) => {
                void socket.on("block", () => undefined);
            });
            await session.provider.send("eth_getBlockByNumber", [
                "latest",
                false
            ]);
            const held = session.relay.holdNext(
                "eth_getBlockByNumber",
                "latest"
            );

            await session.chain.send("evm_mine", []);
            await held.arrived;
            await sleep(ABSENCE_WINDOW_MS);
            const asked = nodeRequests(session, "eth_getBlockByNumber").length;
            const block = await session.provider.send("eth_getBlockByNumber", [
                "latest",
                false
            ]);

            expect(block.number).to.equal(
                toQuantity(await headNumber(session))
            );
            expect(
                nodeRequests(session, "eth_getBlockByNumber")
            ).to.have.length(asked + 1);
            // Mutation: MirrorChain.seenBlock returning undefined drops the
            // block number the second request carries.
            expect(
                serviceRequests(session, "scp_getBlock").map(
                    (request) => request.params
                )
            ).to.deep.equal([
                ["latest", false],
                ["latest", false, toQuantity(await headNumber(session))]
            ]);
            held.release();
        });
    });

    it("holds a read until the mirror reaches the block of a log notification the node pushed first", async function () {
        await withMirrorSession(async (session) => {
            const emitter = await deployLogEmitter(session.signer);
            await emitValue(session.signer, emitter, 1n);
            expect(
                BigInt(await session.provider.getStorage(emitter, 0))
            ).to.equal(1n);
            const logged = new Promise<void>((resolve) => {
                session.rpcNode.watchSockets((socket) => {
                    void socket.on({ address: emitter }, () => resolve());
                });
            });
            await sleep(ABSENCE_WINDOW_MS);
            const release =
                session.service.holdNotifications("scp_subscription");

            await emitValue(session.signer, emitter, 9n);
            await logged;
            let settled = false;
            const read = session.provider
                .getStorage(emitter, 0)
                .finally(() => (settled = true));
            await sleep(ABSENCE_WINDOW_MS);
            expect(settled, "the read waits for the log's block").to.equal(
                false
            );
            release();

            expect(BigInt(await read)).to.equal(9n);
        });
    });
    // Mutation: the block a node announced is never lowered -> after the
    // reorganization every read goes to the node.
    it("answers from the copy again once the node's new head falls below the block it announced before, as after a reorganization to a shorter branch", async function () {
        await withMirrorSession(async (session) => {
            const { storage, chainStorage } =
                await deployMirroredStorage(session);
            expect(await storage.getValue()).to.equal(0n);
            await session.provider.on("block", () => undefined);
            await (await chainStorage.setValue(5n)).wait();
            const checkpoint = await session.chain.send("evm_snapshot", []);
            await (await chainStorage.setValue(6n)).wait();
            await session.chain.send("anvil_mine", [toQuantity(3)]);
            await waitForLocalAnswer(
                session,
                "eth_call",
                () => storage.getValue(),
                6n
            );

            // the replacement branch is three blocks shorter than the announced head
            await session.chain.send("evm_revert", [checkpoint]);
            await (await chainStorage.setValue(9n)).wait();

            await waitForLocalAnswer(
                session,
                "eth_call",
                () => storage.getValue(),
                9n
            );
        });
    });

    // Mutation: the latest announcement of any node replaces the others' ->
    // the lagging node's older head lets the read answer from the older copy.
    it("keeps a read waiting for one node's newer head when another node announces an older head after it", async function () {
        await withMirrorSession(
            async (session) => {
                const lagging = session.second!;
                const { storage, chainStorage } =
                    await deployMirroredStorage(session);
                expect(await storage.getValue()).to.equal(0n);
                // the lagging node's heads wait at its proxy, so no announcement is timed
                const releaseLagging =
                    lagging.node.holdNotifications("eth_subscription");
                // the other node's head of this block comes once the copy has it, so it is not timed either
                const releaseHead =
                    session.node.holdNotifications("eth_subscription");
                await (await chainStorage.setValue(5n)).wait();
                await waitFor(
                    async () => (await storage.getValue()) === 5n,
                    5_000,
                    20
                );
                releaseHead();

                // the provider's own head subscription on the node carries this listener too
                let announced = 0;
                session.rpcNode.watchSockets((socket) => {
                    void socket.on("block", (number: number) => {
                        announced = number;
                    });
                });
                lagging.node.dropNotifications("eth_subscription");
                const releaseService =
                    session.service.holdNotifications("scp_subscription");
                const written = await (await chainStorage.setValue(6n)).wait();
                await waitFor(
                    () => announced === written!.blockNumber,
                    5_000,
                    20
                );
                // the lagging node announces the block before, after the newer head
                releaseLagging();
                // time is the input: the older head reaches the provider
                await sleep(ABSENCE_WINDOW_MS);
                let settled = false;
                const read = storage.getValue().finally(() => (settled = true));
                await sleep(ABSENCE_WINDOW_MS);
                expect(settled, "the read waits for the newer head").to.equal(
                    false
                );
                releaseService();

                expect(await read).to.equal(6n);
                lagging.node.stopDroppingNotifications("eth_subscription");
            },
            { secondNode: true }
        );
    });

    // Mutation: a removed log announces its orphaned block -> the read waits
    // for a block number the replacement branch has not reached.
    it("answers from the copy at once after a reorganization when the node reports an orphaned block's log as removed", async function () {
        await withMirrorSession(async (session) => {
            const emitter = await deployLogEmitter(session.signer);
            await emitValue(session.signer, emitter, 1n);
            expect(
                BigInt(await session.provider.getStorage(emitter, 0))
            ).to.equal(1n);
            await session.provider.on("block", () => undefined);
            session.rpcNode.watchSockets((socket) => {
                void socket.on({ address: emitter }, () => undefined);
            });
            // time is the input: the subscriptions' answers reach the provider
            await sleep(ABSENCE_WINDOW_MS);
            const checkpoint = await session.chain.send("evm_snapshot", []);
            await session.chain.send("anvil_mine", [toQuantity(2)]);
            // the log stays at the proxy, to come back removed after the reorganization
            const withheld = session.node.withholdNotifications();
            const orphaned = await emitValue(session.signer, emitter, 2n);
            withheld.stop();
            // the replacement branch is two blocks shorter than the orphaned log's block
            await session.chain.send("evm_revert", [checkpoint]);
            await emitValue(session.signer, emitter, 3n);
            await waitForLocalAnswer(
                session,
                "eth_getStorageAt",
                async () =>
                    BigInt(await session.provider.getStorage(emitter, 0)),
                3n
            );

            withheld.releaseRemoved(orphaned.hash);
            // time is the input: the removed log reaches the provider
            await sleep(ABSENCE_WINDOW_MS);
            const asked = nodeRequests(session, "eth_getStorageAt").length;
            let settled = false;
            const read = session.provider
                .getStorage(emitter, 0)
                .finally(() => (settled = true));
            await sleep(ABSENCE_WINDOW_MS);

            expect(settled, "the read is answered at once").to.equal(true);
            expect(BigInt(await read)).to.equal(3n);
            expect(nodeRequests(session, "eth_getStorageAt")).to.have.length(
                asked
            );
        });
    });

    // Mutation: a node's log lowers its head as a new head does -> the log of
    // the block before lets the read answer from the older copy.
    it("keeps a read waiting for the node's newer head when the node's log of the block before arrives after it", async function () {
        await withMirrorSession(async (session) => {
            const emitter = await deployLogEmitter(session.signer);
            await emitValue(session.signer, emitter, 1n);
            expect(
                BigInt(await session.provider.getStorage(emitter, 0))
            ).to.equal(1n);
            await session.provider.on("block", () => undefined);
            session.rpcNode.watchSockets((socket) => {
                void socket.on({ address: emitter }, () => undefined);
            });
            // time is the input: the subscriptions' answers reach the provider
            await sleep(ABSENCE_WINDOW_MS);
            // the block's head and log stay at the proxy, so no announcement is timed
            const withheld = session.node.withholdNotifications();
            const logged = await emitValue(session.signer, emitter, 2n);
            withheld.stop();
            await waitFor(
                async () =>
                    BigInt(await session.provider.getStorage(emitter, 0)) ===
                    2n,
                5_000,
                20
            );
            const release =
                session.service.holdNotifications("scp_subscription");
            await session.chain.send("evm_mine", []);
            // time is the input: the node's newer head reaches the provider
            await sleep(ABSENCE_WINDOW_MS);

            // the log of the block before arrives after the newer head
            withheld.release(logged.hash);
            // time is the input: the log reaches the provider
            await sleep(ABSENCE_WINDOW_MS);
            let settled = false;
            const read = session.provider
                .getStorage(emitter, 0)
                .finally(() => (settled = true));
            await sleep(ABSENCE_WINDOW_MS);
            expect(settled, "the read waits for the newer head").to.equal(
                false
            );
            release();

            expect(BigInt(await read)).to.equal(2n);
        });
    });

    // Mutation: any head lower than the node's announced block lowers it ->
    // the late head of the block before lets the read answer from the older copy.
    it("keeps a read waiting for the block of the node's log when the node's head of the block before arrives after that log", async function () {
        await withMirrorSession(async (session) => {
            const emitter = await deployLogEmitter(session.signer);
            await emitValue(session.signer, emitter, 1n);
            expect(
                BigInt(await session.provider.getStorage(emitter, 0))
            ).to.equal(1n);
            await session.provider.on("block", () => undefined);
            session.rpcNode.watchSockets((socket) => {
                void socket.on({ address: emitter }, () => undefined);
            });
            // time is the input: the subscriptions' answers reach the provider
            await sleep(ABSENCE_WINDOW_MS);
            // the node's heads and logs stay at the proxy, so no announcement is timed
            const withheld = session.node.withholdNotifications();
            const earlier = await emitValue(session.signer, emitter, 2n);
            await waitFor(
                async () =>
                    BigInt(await session.provider.getStorage(emitter, 0)) ===
                    2n,
                5_000,
                20
            );
            const release =
                session.service.holdNotifications("scp_subscription");
            const later = await emitValue(session.signer, emitter, 3n);
            withheld.stop();

            // the later block's log arrives first, then the earlier block's head
            withheld.release(later.hash);
            withheld.releaseHead(earlier.blockNumber);
            // time is the input: both reach the provider
            await sleep(ABSENCE_WINDOW_MS);
            let settled = false;
            const read = session.provider
                .getStorage(emitter, 0)
                .finally(() => (settled = true));
            await sleep(ABSENCE_WINDOW_MS);
            expect(settled, "the read waits for the log's block").to.equal(
                false
            );
            release();

            expect(BigInt(await read)).to.equal(3n);
        });
    });

    // Mutation: lowering the block reads wait for wakes no waiting read -> the
    // read waits out the backstop and goes to the node.
    it("answers a read already waiting for an orphaned block from the copy once the node's lower head arrives", async function () {
        await withMirrorSession(async (session) => {
            const { storage, chainStorage } =
                await deployMirroredStorage(session);
            expect(await storage.getValue()).to.equal(0n);
            await session.provider.on("block", () => undefined);
            // the node's heads stay at the proxy until the copy has their blocks, so none is timed
            const releaseHeads =
                session.node.holdNotifications("eth_subscription");
            await (await chainStorage.setValue(5n)).wait();
            const checkpoint = await session.chain.send("evm_snapshot", []);
            await (await chainStorage.setValue(6n)).wait();
            await waitFor(
                async () => (await storage.getValue()) === 6n,
                5_000,
                20
            );
            releaseHeads();
            // time is the input: the heads reach the provider
            await sleep(ABSENCE_WINDOW_MS);
            // the copy never gets the next block the node announces
            session.service.dropNotifications("scp_subscription");
            await (await chainStorage.setValue(7n)).wait();
            // time is the input: the node's announcement reaches the provider
            await sleep(ABSENCE_WINDOW_MS);
            const releaseLowerHead =
                session.node.holdNotifications("eth_subscription");
            const asked = nodeRequests(session, "eth_call").length;
            let settled = false;
            const read = storage.getValue().finally(() => (settled = true));
            await sleep(ABSENCE_WINDOW_MS);
            expect(settled, "the read waits for the announced block").to.equal(
                false
            );

            // the copy follows a shorter replacement branch before the node's head shows it
            session.service.stopDroppingNotifications("scp_subscription");
            await session.chain.send("evm_revert", [checkpoint]);
            await (await chainStorage.setValue(9n)).wait();
            // time is the input: the replacement block reaches the copy
            await sleep(ABSENCE_WINDOW_MS);
            releaseLowerHead();
            // time is the input: the lower head reaches the provider
            await sleep(ABSENCE_WINDOW_MS);

            expect(settled, "the lower head ends the wait").to.equal(true);
            expect(await read).to.equal(9n);
            expect(nodeRequests(session, "eth_call")).to.have.length(asked);
        });
    });

    // Mutation: lowering keeps the orphaned heights' announcements -> the
    // replacement block is timed from the orphan's, and the backstop is the cap.
    it("keeps the learned backstop after a reorganization to a shorter branch, timing the replacement block from its own announcement", async function () {
        await withMirrorSession(async (session) => {
            const { storage, chainStorage } =
                await deployMirroredStorage(session);
            await teachBackstop(session, chainStorage);
            // the copy has the taught blocks
            expect(await storage.getValue()).to.equal(4n);
            const checkpoint = await session.chain.send("evm_snapshot", []);
            // two blocks the node announces and the copy never gets
            session.service.dropNotifications("scp_subscription");
            await (await chainStorage.setValue(5n)).wait();
            await session.chain.send("evm_mine", []);
            await sleep(ORPHAN_AGE_MS);
            // the replacement block reaches the copy after the node's lower head
            const releaseReplacement =
                session.service.holdNotifications("scp_subscription");
            session.service.stopDroppingNotifications("scp_subscription");
            const heads = session.node.deliveredCount("eth_subscription");

            // the replacement branch is one block, at the first orphaned height
            await session.chain.send("evm_revert", [checkpoint]);
            await (await chainStorage.setValue(9n)).wait();
            await waitFor(
                () => session.node.deliveredCount("eth_subscription") > heads,
                5_000,
                5
            );
            // time is the input: the provider handles the head it was sent
            await sleep(50);
            releaseReplacement();
            await waitForLocalAnswer(
                session,
                "eth_call",
                () => storage.getValue(),
                9n
            );
            const release =
                session.service.holdNotifications("scp_subscription");
            await (await storage.setValue(7n)).wait();
            const started = Date.now();
            const value = await storage.getValue();
            const elapsed = Date.now() - started;

            expect(value).to.equal(7n);
            // the wait is the learned bound, not the cap
            expect(elapsed).to.be.lessThan((SDK_RPC_DEADLINE_MS * 2) / 3);
            release();
        });
    });
});
