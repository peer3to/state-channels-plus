import { sleep } from "@/utils";
import {
    ABSENCE_WINDOW_MS,
    deliveries,
    values,
    watchEmitter
} from "@test/fixtures/node/LogFeedFixture";
import {
    headNumber,
    nodeRequests,
    serviceRequests,
    withMirrorSession
} from "@test/fixtures/node/RpcMirrorFixture";
import {
    deployLogEmitter,
    emitValue,
    storageWord,
    VALUE_SET_TOPIC
} from "@test/fixtures/node/StorageDiffContracts";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { toQuantity, type Log } from "ethers";

describe("Log feed", function () {
    it("hands on a log with the fields the node's eth_getLogs has, once its block is on the service's chain", async function () {
        await withMirrorSession(async (session) => {
            const emitter = await deployLogEmitter(session.signer);
            const watch = watchEmitter(
                session,
                emitter,
                (await headNumber(session)) + 1
            );

            const receipt = await emitValue(session.signer, emitter, 7n);

            await waitFor(() => watch.logs.length === 1);
            const [expected] = await session.chain.getLogs({
                address: emitter,
                fromBlock: receipt.blockNumber,
                toBlock: receipt.blockNumber
            });
            const [log] = watch.logs;
            expect({
                address: log.address,
                topics: log.topics,
                data: log.data,
                blockNumber: log.blockNumber,
                blockHash: log.blockHash,
                transactionHash: log.transactionHash,
                transactionIndex: log.transactionIndex,
                index: log.index,
                removed: log.removed
            }).to.deep.equal({
                address: expected.address,
                topics: [...expected.topics],
                data: expected.data,
                blockNumber: expected.blockNumber,
                blockHash: expected.blockHash,
                transactionHash: expected.transactionHash,
                transactionIndex: expected.transactionIndex,
                index: expected.index,
                removed: false
            });
            expect(nodeRequests(session, "eth_getLogs")).to.have.length(0);
            watch.stop();
        });
    });

    it("hands on the logs of several blocks in block order, once to each of two watches of the same filter", async function () {
        await withMirrorSession(async (session) => {
            const emitter = await deployLogEmitter(session.signer);
            const from = (await headNumber(session)) + 1;
            const watch = watchEmitter(session, emitter, from);
            const second = watchEmitter(session, emitter, from);

            await emitValue(session.signer, emitter, 1n);
            await emitValue(session.signer, emitter, 2n);
            await emitValue(session.signer, emitter, 3n);

            await waitFor(
                () => watch.logs.length >= 3 && second.logs.length >= 3
            );
            await sleep(ABSENCE_WINDOW_MS);
            // Mutation: a known block hash not skipped, a block's logs are handed on again
            expect(values(watch)).to.deep.equal([1n, 2n, 3n]);
            expect(values(second)).to.deep.equal([1n, 2n, 3n]);
            const blocks = watch.logs.map((log) => log.blockNumber);
            expect(blocks).to.deep.equal([...blocks].sort((a, b) => a - b));
            watch.stop();
            second.stop();
        });
    });

    it("hands on no log of a block before the block it was asked to start at", async function () {
        await withMirrorSession(async (session) => {
            const emitter = await deployLogEmitter(session.signer);
            const earlier = await emitValue(session.signer, emitter, 1n);
            const watch = watchEmitter(
                session,
                emitter,
                earlier.blockNumber + 1
            );

            await emitValue(session.signer, emitter, 2n);

            await waitFor(() => watch.logs.length === 1);
            await sleep(ABSENCE_WINDOW_MS);
            expect(values(watch)).to.deep.equal([2n]);
            watch.stop();
        });
    });

    it("hands on no log of another address or of another topic", async function () {
        await withMirrorSession(async (session) => {
            const emitter = await deployLogEmitter(session.signer);
            const other = await deployLogEmitter(session.signer);
            const from = (await headNumber(session)) + 1;
            const watch = watchEmitter(session, emitter, from);
            const unmatched: Log[] = [];
            const stopWrongTopic = session.provider.logs.watch(
                { address: emitter, topics: [`0x${"11".repeat(32)}`] },
                from,
                (log) => unmatched.push(log)
            );

            await emitValue(session.signer, other, 5n);
            await emitValue(session.signer, emitter, 6n);

            await waitFor(() => watch.logs.length === 1);
            await sleep(ABSENCE_WINDOW_MS);
            expect(values(watch)).to.deep.equal([6n]);
            expect(unmatched).to.have.length(0);
            watch.stop();
            stopWrongTopic();
        });
    });

    it("hands on a log again as removed when a reorg replaces its block at the same height, then the replacing block's log", async function () {
        await withMirrorSession(async (session) => {
            const emitter = await deployLogEmitter(session.signer);
            const watch = watchEmitter(
                session,
                emitter,
                (await headNumber(session)) + 1
            );
            const orphaned = await emitValue(session.signer, emitter, 1n);
            await waitFor(() => watch.logs.length === 1);

            // the block of the log is replaced by one at the same height
            // Mutation: no head-hash check without records, the removal waits for a later block
            await session.chain.send("anvil_reorg", [1, []]);

            await waitFor(() => watch.logs.length === 2);
            expect(deliveries(watch)).to.deep.equal([
                [1n, false],
                [1n, true]
            ]);
            expect(watch.logs[1].blockHash).to.equal(orphaned.blockHash);
            watch.stop();
        });
    });

    it("hands on, newest first and as removed, the logs of every block a deeper reorg replaced, none of a block below the fork, then the logs of the new chain", async function () {
        await withMirrorSession(async (session) => {
            const emitter = await deployLogEmitter(session.signer);
            const watch = watchEmitter(
                session,
                emitter,
                (await headNumber(session)) + 1
            );
            await emitValue(session.signer, emitter, 1n);
            await emitValue(session.signer, emitter, 2n);
            await emitValue(session.signer, emitter, 3n);
            await waitFor(() => watch.logs.length === 3);

            // the blocks of 2 and 3 replaced; the new chain then grows past them
            // Mutation: the oldest kept block not read again, the fork below the first record is missed
            await session.chain.send("anvil_reorg", [2, []]);
            await emitValue(session.signer, emitter, 4n);

            // Mutation: a kept block's unchanged hash not skipped, log 1 is handed on again
            await waitFor(() => watch.logs.length === 6);
            await sleep(ABSENCE_WINDOW_MS);
            expect(deliveries(watch)).to.deep.equal([
                [1n, false],
                [2n, false],
                [3n, false],
                [3n, true],
                [2n, true],
                [4n, false]
            ]);
            watch.stop();
        });
    });

    it("reads the chain at the block of a log it handed on before the mirror applied that block", async function () {
        await withMirrorSession(async (session) => {
            const emitter = await deployLogEmitter(session.signer);
            // follows the emitter's storage
            await session.provider.getStorage(emitter, 0);
            // the block's record reaches the mirror only after the log
            const releaseRecords =
                session.service.holdNotifications("scp_subscription");
            // Mutation: `requireNumber` removed from the subject, red only
            // while the node's head push is held too
            const releaseHeads =
                session.node.holdNotifications("eth_subscription");
            const receipt = await emitValue(session.signer, emitter, 7n);
            const reads: Promise<string>[] = [];

            // the watch's first read answers the block the mirror lacks
            const stop = session.provider.logs.watch(
                { address: emitter, topics: [VALUE_SET_TOPIC] },
                receipt.blockNumber,
                () => reads.push(session.provider.getStorage(emitter, 0))
            );
            await waitFor(() => reads.length === 1);
            releaseRecords();
            releaseHeads();

            expect(BigInt(await reads[0])).to.equal(7n);
            stop();
        });
    });

    it("hands on a log mined while the service connection was cut, after it is back", async function () {
        await withMirrorSession(async (session) => {
            const emitter = await deployLogEmitter(session.signer);
            const watch = watchEmitter(
                session,
                emitter,
                (await headNumber(session)) + 1
            );
            await waitFor(
                () =>
                    serviceRequests(session, "scp_getContractStorageDiffs")
                        .length > 0
            );

            session.service.cut();
            await emitValue(session.signer, emitter, 9n);
            await sleep(ABSENCE_WINDOW_MS);
            expect(watch.logs).to.have.length(0);
            session.service.restore();

            await waitFor(() => watch.logs.length === 1);
            expect(values(watch)).to.deep.equal([9n]);
            watch.stop();
        });
    });

    it("reads blocks the service no longer retains from the node, up to the node's head", async function () {
        await withMirrorSession(
            async (session) => {
                const emitter = await deployLogEmitter(session.signer);
                const first = await emitValue(session.signer, emitter, 1n);
                await emitValue(session.signer, emitter, 2n);
                await emitValue(session.signer, emitter, 3n);
                const head = await headNumber(session);

                const watch = watchEmitter(session, emitter, first.blockNumber);

                await waitFor(() => watch.logs.length === 3);
                await sleep(ABSENCE_WINDOW_MS);
                expect(values(watch)).to.deep.equal([1n, 2n, 3n]);
                expect(
                    nodeRequests(session, "eth_getLogs").map(
                        (request) =>
                            (request.params as { toBlock: string }[])[0].toBlock
                    )
                ).to.deep.equal([toQuantity(head)]);
                await emitValue(session.signer, emitter, 4n);
                await waitFor(() => watch.logs.length === 4);
                expect(values(watch)).to.deep.equal([1n, 2n, 3n, 4n]);
                watch.stop();
            },
            { retention: 2 }
        );
    });

    it("reads a reorg the service no longer retains the fork of from the node: logs already handed on are not handed on again, a replaced one comes again as removed", async function () {
        await withMirrorSession(
            async (session) => {
                const emitter = await deployLogEmitter(session.signer);
                const watch = watchEmitter(
                    session,
                    emitter,
                    (await headNumber(session)) + 1
                );
                for (const value of [1n, 2n, 3n, 4n])
                    await emitValue(session.signer, emitter, value);
                await waitFor(() => watch.logs.length === 4);
                const [from] = await session.chain.listAccounts();

                // the newest block is replaced by one with the same call
                await session.chain.send("anvil_reorg", [
                    1,
                    [
                        [
                            {
                                from: from.address,
                                to: emitter,
                                data: storageWord(4n),
                                // the reorg does not estimate: the call's own gas
                                gas: toQuantity(100_000)
                            },
                            0
                        ]
                    ]
                ]);

                // Mutation: the node log's handed-on index not checked, logs 1 to 3 are handed on again
                await waitFor(() => watch.logs.length === 6);
                await sleep(ABSENCE_WINDOW_MS);
                expect(deliveries(watch)).to.deep.equal([
                    [1n, false],
                    [2n, false],
                    [3n, false],
                    [4n, false],
                    [4n, true],
                    [4n, false]
                ]);
                expect(watch.logs[5].blockHash).to.not.equal(
                    watch.logs[3].blockHash
                );
                expect(nodeRequests(session, "eth_getLogs")).to.have.length(1);
                watch.stop();
            },
            { retention: 2 }
        );
    });

    it("hands on nothing that a read in flight when the watch is stopped answers", async function () {
        await withMirrorSession(async (session) => {
            const emitter = await deployLogEmitter(session.signer);
            const held = session.service.holdReplies(
                "scp_getContractStorageDiffs"
            );
            const watch = watchEmitter(
                session,
                emitter,
                (await headNumber(session)) + 1
            );
            await waitFor(() => held.heldReplies() === 1);
            // the head moves while the first read is still out
            await emitValue(session.signer, emitter, 1n);

            // Mutation: `stopped` not set in LogWatch.stop, the read in flight reads again and hands on the log
            watch.stop();
            held.release();

            await sleep(ABSENCE_WINDOW_MS);
            expect(watch.logs).to.have.length(0);
        });
    });

    it("hands on nothing more after the watch is stopped", async function () {
        await withMirrorSession(async (session) => {
            const emitter = await deployLogEmitter(session.signer);
            const watch = watchEmitter(
                session,
                emitter,
                (await headNumber(session)) + 1
            );
            await emitValue(session.signer, emitter, 1n);
            await waitFor(() => watch.logs.length === 1);

            watch.stop();
            await emitValue(session.signer, emitter, 2n);

            await sleep(ABSENCE_WINDOW_MS);
            expect(values(watch)).to.deep.equal([1n]);
        });
    });
});
