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
import { waitFor } from "@test/utils/waitFor";
import type { SimpleNumberStorage } from "@typechain-types";
import { expect } from "chai";
import { toQuantity, ZeroAddress } from "ethers";

/** Time is the input: how long a read that must wait is watched for. */
const ABSENCE_WINDOW_MS = 500;
/** Time is the input: how long a held node reply makes a round trip. */
const NODE_ROUND_TRIP_MS = 400;

/** Time is the input: how long after its announcement the slowest taught block reaches the copy. */
const SLOW_RECORD_MS = 100;

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

            // the node rolls back below the block the next read waits for
            await session.chain.send("anvil_rollback", [2]);
            await session.chain.send("evm_mine", []);
            // time is the input: the new head reaches the copy
            await sleep(ABSENCE_WINDOW_MS);
            const probesBefore = serviceRequests(session, "scp_getHead").length;
            const second = storage.getValue();
            // time is the input: how long a probe the wait would send is watched for
            await sleep(ABSENCE_WINDOW_MS);

            expect(serviceRequests(session, "scp_getHead")).to.have.length(
                probesBefore + 1
            );
            // the block never reaches the copy again: the node answers
            expect(await second).to.equal(0n);
        });
    });

    it("shortens the longest wait as the node's round trips grow, and a read that waits the whole cap still gets the node's answer inside the deadline", async function () {
        await withMirrorSession(async (session) => {
            const { storage } = await deployMirroredStorage(session);
            expect(await storage.getValue()).to.equal(0n);

            // the node answers a forwarded request slowly: that is a round trip learned
            const slowReply = session.node.holdReplies("eth_gasPrice");
            const forwarded = session.provider.send("eth_gasPrice", []);
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
});
