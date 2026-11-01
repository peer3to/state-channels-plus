import { sleep } from "@/utils";
import { DepthIncludedHeadStrategy } from "@/utils/node/storageDiff/includedHead/DepthIncludedHeadStrategy";
import { SDK_RPC_DEADLINE_MS } from "@/utils/storageDiff/LearnedBackstop";
import { NOT_RETAINED_ERROR_CODE } from "@/utils/storageDiff/storageDiffWire";
import {
    deployCommitProbe,
    deployEnvironmentProbe,
    backfillAtService,
    deployMirroredStorage,
    headNumber,
    nodeRequests,
    nodeStateReads,
    serviceRequests,
    waitUntilAnsweredLocally,
    withMirrorSession,
    withSubstrateMirrorSession,
    type MirrorSession
} from "@test/fixtures/node/RpcMirrorFixture";
import {
    asksCallFrames,
    deployLogEmitter,
    deploySlotWriter,
    writeSlot,
    emitValue,
    rejectionOf
} from "@test/fixtures/node/StorageDiffService.fixture";
import { waitFor } from "@test/utils/waitFor";
import type { SimpleNumberStorage } from "@typechain-types";
import { expect } from "chai";
import { isError, toBeHex, toQuantity, ZeroAddress, ZeroHash } from "ethers";

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

describe("MirrorRpcProvider", function () {
    it("answers an eth_call at latest without sending an eth_call to the node", async function () {
        await withMirrorSession(async (session) => {
            const { storage } = await deployMirroredStorage(session);
            await (await storage.setValue(5n)).wait();

            expect(await storage.getValue()).to.equal(5n);

            expect(nodeRequests(session, "eth_call")).to.have.length(0);
        });
    });

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

    it("applies a snapshot that reaches the mirror before the reply of the subscription that asked for it", async function () {
        await withMirrorSession(async (session) => {
            // the mirror follows the first contract before the second is deployed
            const first = await deployMirroredStorage(session);
            await first.storage.getValue();
            const second = await deployMirroredStorage(session);
            await (await second.storage.setValue(5n)).wait();
            await backfillAtService(session, [second.address]);
            const asked = serviceRequests(session, "scp_getState").length;
            const held = session.service.holdReplies(
                "scp_subscribeContractStorage"
            );

            const read = session.provider.getStorage(second.address, 0);
            // the snapshot is pushed while the subscribe reply is held back
            await waitFor(() => held.heldReplies() > 0, 5_000, 20);
            await sleep(500);
            held.release();

            expect(BigInt(await read)).to.equal(5n);
            expect(serviceRequests(session, "scp_getState")).to.have.length(
                asked
            );
        });
    });

    it("waits for the snapshot of an account the service has ready instead of reading lazily", async function () {
        await withMirrorSession(async (session) => {
            const { storage, address } = await deployMirroredStorage(session);
            await (await storage.setValue(5n)).wait();
            await backfillAtService(session, [address]);
            const release = session.service.holdNotifications("scp_snapshot");

            const read = session.provider.getStorage(address, 0);
            await sleep(300);
            release();
            const word = await read;

            expect(BigInt(word)).to.equal(5n);
            // Mutation: not awaiting the snapshot (reading lazily) asks the service
            expect(serviceRequests(session, "scp_getState")).to.have.length(0);
            expect(nodeStateReads(session)).to.equal(0);
        });
    });

    it("reads an account the service says is syncing at once, and answers locally once its snapshot has come", async function () {
        await withMirrorSession(async (session) => {
            const { storage, address } = await deployMirroredStorage(session);
            await (await storage.setValue(5n)).wait();
            const release = session.service.holdNotifications("scp_snapshot");

            const word = await session.provider.getStorage(address, 0);

            // answered while the snapshot is held back: one state request
            expect(BigInt(word)).to.equal(5n);
            expect(serviceRequests(session, "scp_getState")).to.have.length(1);
            release();
            await waitUntilAnsweredLocally(session, address);
            // the code and the slot are local now: a contract call needs no lazy read
            const asked = serviceRequests(session, "scp_getState").length;
            expect(await storage.getValue()).to.equal(5n);
            expect(serviceRequests(session, "scp_getState")).to.have.length(
                asked
            );
        });
    });

    it("reads an account the service says is lazy at once, without waiting for a snapshot", async function () {
        // the node counts one entry more than the history names
        await withSubstrateMirrorSession(2, async (session, contract) => {
            const { chainStorage, address } =
                await deployMirroredStorage(session);
            contract.address = address.toLowerCase();
            contract.deployed = await session.chain.getBlockNumber();
            await (await chainStorage.setValue(5n)).wait();
            contract.changes.push(contract.deployed, contract.deployed + 1);
            await backfillAtService(session, [address]);
            // the notice is held back: the subscribe answer alone says lazy
            const release = session.service.holdNotifications("scp_snapshot");

            const word = await session.provider.getStorage(address, 0);
            release();

            // answered while the snapshot is held back, and no backstop ran out
            expect(BigInt(word)).to.equal(5n);
            // Mutation: entries 1 (the history's count) makes the account
            // complete, so the read comes from the snapshot, not the service.
            expect(serviceRequests(session, "scp_getState")).to.have.length(1);
        });
    });

    it("keeps an account lazy when the backfill of a syncing account ends without a snapshot", async function () {
        // the node counts one entry more than the history names
        await withSubstrateMirrorSession(2, async (session, contract) => {
            const { chainStorage, address } =
                await deployMirroredStorage(session);
            contract.address = address.toLowerCase();
            contract.deployed = await session.chain.getBlockNumber();
            await (await chainStorage.setValue(5n)).wait();
            contract.changes.push(contract.deployed, contract.deployed + 1);

            const word = await session.provider.getStorage(address, 0);
            // the notice that no snapshot is coming
            await waitFor(
                () => session.service.deliveredCount("scp_snapshot") === 1,
                5_000,
                20
            );

            expect(BigInt(word)).to.equal(5n);
            // still lazy: a slot the mirror has not read is asked for
            expect(await session.provider.getStorage(address, 1)).to.equal(
                ZeroHash
            );
            // Mutation: entries 1 (the history's count) makes the account
            // complete, so no read asks the service.
            expect(serviceRequests(session, "scp_getState")).to.have.length(2);
        });
    });

    it("keeps an account lazy when the backfill of a syncing account fails", async function () {
        await withMirrorSession(async (session) => {
            const { storage, address } = await deployMirroredStorage(session);
            await (await storage.setValue(5n)).wait();
            // the service has staged the blocks; the backfill's own reads fail
            await sleep(500);
            session.relay.failNext("eth_getBlockByNumber", 50);

            const word = await session.provider.getStorage(address, 0);
            // the notice that no snapshot is coming
            await waitFor(
                () => session.service.deliveredCount("scp_snapshot") === 1,
                10_000,
                20
            );

            expect(BigInt(word)).to.equal(5n);
            // still lazy: a slot the mirror has not read is asked for
            expect(await session.provider.getStorage(address, 1)).to.equal(
                ZeroHash
            );
            // Mutation: a snapshot applied after the failed backfill would
            // answer the second read locally.
            expect(serviceRequests(session, "scp_getState")).to.have.length(2);
        });
    });

    it("asks the node, after a backstop learned from snapshot arrivals, for a snapshot the service has ready and never delivers", async function () {
        await withMirrorSession(async (session) => {
            const { address: taught } = await deployMirroredStorage(session);
            const { chainStorage, address } =
                await deployMirroredStorage(session);
            await (await chainStorage.setValue(3n)).wait();
            await backfillAtService(session, [taught, address]);
            // a snapshot that arrives teaches how long snapshots take
            await session.provider.getStorage(taught, 0);
            session.service.dropNotifications("scp_snapshot");

            const started = Date.now();
            const word = await session.provider.getStorage(address, 0);
            const elapsed = Date.now() - started;

            expect(BigInt(word)).to.equal(3n);
            // Mutation: a snapshot backstop that stays at its cap makes the
            // read wait past this bound.
            expect(elapsed).to.be.lessThan(SDK_RPC_DEADLINE_MS / 2);
            expect(nodeRequests(session, "eth_getStorageAt")).to.have.length(1);
        });
    });

    it("does not shorten the wait for a snapshot because blocks arrived fast", async function () {
        await withMirrorSession(async (session) => {
            const { chainStorage, address } =
                await deployMirroredStorage(session);
            await (await chainStorage.setValue(5n)).wait();
            await backfillAtService(session, [address]);
            // an account the service is still backfilling is read lazily: the
            // mirror follows, and its snapshot is held back so it teaches nothing
            const { address: warm } = await deployMirroredStorage(session);
            const releaseWarm =
                session.service.holdNotifications("scp_snapshot");
            await session.provider.getStorage(warm, 0);
            await session.provider.on("block", () => undefined);
            for (let value = 1n; value <= 3n; value++)
                await (await chainStorage.setValue(value)).wait();
            releaseWarm();
            const release = session.service.holdNotifications("scp_snapshot");

            const read = session.provider.getStorage(address, 0);
            // time is the input: longer than the bound the blocks taught, shorter than the snapshot cap
            await sleep(SDK_RPC_DEADLINE_MS * 0.6);
            release();
            const word = await read;

            // the last value teachBackstop wrote
            expect(BigInt(word)).to.equal(3n);
            // Mutation: a snapshot backstop learned from block arrivals sends
            // the read to the node before the snapshot is released.
            expect(nodeRequests(session, "eth_getStorageAt")).to.have.length(0);
        });
    });

    it("stops waiting for a snapshot at once when the service connection drops", async function () {
        await withMirrorSession(async (session) => {
            const { storage, address } = await deployMirroredStorage(session);
            await (await storage.setValue(5n)).wait();
            await backfillAtService(session, [address]);
            session.service.dropNotifications("scp_snapshot");

            const started = Date.now();
            const read = session.provider.getStorage(address, 0);
            await sleep(300);
            session.service.cut();
            const word = await read;

            // the node answers when the cut ends the wait, not the backstop
            expect(BigInt(word)).to.equal(5n);
            // Mutation: a cut that leaves the wait to the backstop (the cap,
            // no snapshot having arrived) takes the whole cap.
            expect(Date.now() - started).to.be.lessThan(
                SDK_RPC_DEADLINE_MS / 2
            );
        });
    });

    it("re-asks the node about a sampled read after replying, and keeps the account when the node agrees", async function () {
        await withMirrorSession(
            async (session) => {
                const { storage, address } =
                    await deployMirroredStorage(session);
                await (await storage.setValue(5n)).wait();
                const held = session.node.holdReplies("eth_getStorageAt");

                const word = await Promise.race([
                    session.provider.getStorage(address, 0),
                    sleep(2_000).then(() => "the answer waited for the sample")
                ]);

                // the caller has its answer while the node's reply to the sample is still held
                expect(BigInt(word)).to.equal(5n);
                await waitFor(() => held.heldReplies() > 0, 5_000, 20);
                held.release();
                expect(nodeStateReads(session)).to.equal(1);

                // the next reads are sampled again and still answered by the copy
                expect(
                    BigInt(await session.provider.getStorage(address, 0))
                ).to.equal(5n);
                await waitFor(() => nodeStateReads(session) >= 2, 5_000, 20);
                expect(
                    BigInt(await session.provider.getStorage(address, 0))
                ).to.equal(5n);
                await waitFor(() => nodeStateReads(session) >= 3, 5_000, 20);
                // Mutation: a match treated as a mismatch drops the account,
                // and the third read then asks the node as well as sampling.
                expect(nodeStateReads(session)).to.equal(3);
            },
            { sampleRate: 1 }
        );
    });

    it("samples balance, nonce and code reads against the node too", async function () {
        await withMirrorSession(
            async (session) => {
                const { address } = await deployMirroredStorage(session);
                const owner = await session.signer.getAddress();

                await session.provider.getBalance(address);
                await session.provider.getCode(address);
                await session.provider.getTransactionCount(owner, "latest");
                await waitFor(
                    () =>
                        nodeRequests(session, "eth_getTransactionCount")
                            .length === 1,
                    5_000,
                    20
                );

                expect(nodeRequests(session, "eth_getBalance")).to.have.length(
                    1
                );
                expect(nodeRequests(session, "eth_getCode")).to.have.length(1);
            },
            { sampleRate: 1 }
        );
    });

    it("sends nothing to the node at a sample rate of 0", async function () {
        await withMirrorSession(
            async (session) => {
                const { storage, address } =
                    await deployMirroredStorage(session);
                await (await storage.setValue(5n)).wait();

                await session.provider.getStorage(address, 0);
                await session.provider.getBalance(address);
                await storage.getValue();
                await sleep(300);

                expect(nodeStateReads(session)).to.equal(0);
                expect(nodeRequests(session, "eth_call")).to.have.length(0);
            },
            { sampleRate: 0 }
        );
    });

    it("samples a small fraction of local answers when the provider is built without a sample rate", async function () {
        await withMirrorSession(
            async (session) => {
                const { address } = await deployMirroredStorage(session);
                await session.provider.getBalance(address);
                const before = nodeRequests(session, "eth_getBalance").length;

                const reads = 2_000;
                for (let read = 0; read < reads; read++)
                    await session.provider.getBalance(address);
                await waitFor(
                    () =>
                        nodeRequests(session, "eth_getBalance").length > before,
                    5_000,
                    20
                );
                await sleep(300);

                // about one in a hundred (20 of 2,000 expected); always some, never most
                const sampled =
                    nodeRequests(session, "eth_getBalance").length - before;
                expect(sampled).to.be.greaterThan(0);
                expect(sampled).to.be.lessThan(reads / 10);
            },
            { sampleRate: undefined }
        );
    });

    it("counts a mismatch between a cached value and the node, and reads the account from the node from then on", async function () {
        await withMirrorSession(
            async (session) => {
                const { storage, address } =
                    await deployMirroredStorage(session);
                // the service reads slot values wrongly, so its snapshot is wrong
                session.relay.tamper("eth_getStorageAt", (result) =>
                    toBeHex(BigInt(result as string) + 1n, 32)
                );
                await (await storage.setValue(5n)).wait();

                const wrong = await session.provider.getStorage(address, 0);
                // the mismatch drops the account: the read then comes from the node
                await waitFor(
                    async () =>
                        BigInt(
                            await session.provider.getStorage(address, 0)
                        ) === 5n,
                    5_000,
                    20
                );

                expect(BigInt(wrong)).to.equal(6n);
            },
            { sampleRate: 1 }
        );
    });

    it("checks a sampled eth_call against the node and drops the called account on a mismatch", async function () {
        await withMirrorSession(
            async (session) => {
                const { storage, address } =
                    await deployMirroredStorage(session);
                session.relay.tamper("eth_getStorageAt", (result) =>
                    toBeHex(BigInt(result as string) + 1n, 32)
                );
                await (await storage.setValue(5n)).wait();

                const wrong = await storage.getValue();
                // the mismatch drops the called account: the call then reads it from the node
                await waitFor(
                    async () => (await storage.getValue()) === 5n,
                    5_000,
                    20
                );

                expect(wrong).to.equal(6n);
            },
            { sampleRate: 1 }
        );
    });

    it("drops a complete account to lazy reads when the service finds its cached entries short after a block, and reads the omitted slot", async function () {
        let omitFrom = Number.MAX_SAFE_INTEGER;
        await withSubstrateMirrorSession(
            (n) => (n >= omitFrom ? 3 : 2),
            async (session, contract) => {
                const writer = await deploySlotWriter(session.signer);
                contract.address = writer;
                const deployed = await session.chain.getBlockNumber();
                contract.deployed = deployed;
                await writeSlot(session.signer, writer, 1, 5n);
                await writeSlot(session.signer, writer, 2, 7n);
                contract.changes.push(deployed, deployed + 1, deployed + 2);
                // the service has the account complete: the mirror takes its snapshot
                await backfillAtService(session, [writer]);
                expect(
                    BigInt(await session.provider.getStorage(writer, 1))
                ).to.equal(5n);

                // the next block's trace lists the account but not the slot it wrote
                omitFrom = deployed + 3;
                session.relay.tamper(
                    "debug_traceBlockByNumber",
                    (result, params) =>
                        asksCallFrames(params)
                            ? result
                            : (
                                  result as {
                                      result: {
                                          pre: object;
                                          post: Record<string, object>;
                                      };
                                  }[]
                              ).map((entry) => ({
                                  ...entry,
                                  result: {
                                      pre: entry.result.pre,
                                      post: {
                                          ...entry.result.post,
                                          [writer]: { storage: {} }
                                      }
                                  }
                              }))
                );
                await writeSlot(session.signer, writer, 3, 9n);
                // a complete cache would answer zero for the slot the trace left out
                await waitFor(
                    async () =>
                        BigInt(await session.provider.getStorage(writer, 3)) ===
                        9n,
                    5_000,
                    20
                );
            }
        );
    });

    it("answers a call that carries a gas limit from the node, which charges the transaction gas the local EVM does not", async function () {
        await withMirrorSession(async (session) => {
            const { storage, address } = await deployMirroredStorage(session);
            await (await storage.setValue(5n)).wait();
            await storage.getValue();
            const call = (gasLimit?: bigint) =>
                session.provider.call({
                    to: address,
                    data: storage.interface.encodeFunctionData("getValue"),
                    ...(gasLimit === undefined ? {} : { gasLimit })
                });
            const nodeCalls = () => nodeRequests(session, "eth_call").length;
            const before = nodeCalls();

            // below the 21,000 of intrinsic gas: the node refuses, a local run would not
            const refused = await rejectionOf(call(21_000n));

            expect(refused).to.be.instanceOf(Error);
            expect(nodeCalls() - before).to.equal(1);
            expect(BigInt(await call())).to.equal(5n);
            // a call without a limit stays local
            expect(nodeCalls() - before).to.equal(1);
        });
    });

    it("asks the service for exactly the missing fields, at the head block, for an account that is syncing", async function () {
        await withMirrorSession(async (session) => {
            const { storage, address } = await deployMirroredStorage(session);
            await (await storage.setValue(5n)).wait();
            // the snapshot is held back, so the read has to ask for the field
            const release = session.service.holdNotifications("scp_snapshot");
            const head = await session.chain.getBlock(
                await headNumber(session)
            );

            const word = await session.provider.getStorage(address, 0);
            release();

            expect(BigInt(word)).to.equal(5n);
            expect(
                serviceRequests(session, "scp_getState").map(
                    (request) => request.params
                )
            ).to.deep.equal([
                [
                    head!.hash,
                    [
                        {
                            address: address.toLowerCase(),
                            slots: [ZeroHash],
                            account: false,
                            code: false
                        }
                    ]
                ]
            ]);
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

    it("returns what the node returns at the same head for a call, a revert and a read of account state", async function () {
        await withMirrorSession(async (session) => {
            const { storage, chainStorage, address } =
                await deployMirroredStorage(session);
            await (await chainStorage.setValue(11n)).wait();
            const getState = await storage.getState.populateTransaction();

            expect(await session.provider.call(getState)).to.equal(
                await session.chain.call(getState)
            );
            expect(await session.provider.getCode(address)).to.equal(
                await session.chain.getCode(address)
            );
            expect(
                await session.provider.getBalance(session.wallet.address)
            ).to.equal(await session.chain.getBalance(session.wallet.address));
            const mirrored = await rejectionOf(
                storage.revertWithMessage.staticCall("boom")
            );
            const direct = await rejectionOf(
                chainStorage.revertWithMessage.staticCall("boom")
            );
            expect(isError(mirrored, "CALL_EXCEPTION")).to.equal(true);
            expect((mirrored as { reason?: string }).reason).to.equal(
                (direct as { reason?: string }).reason
            );
            expect(nodeRequests(session, "eth_call")).to.have.length(0);
        });
    });

    it("discards what a call wrote when it ends", async function () {
        await withMirrorSession(async (session) => {
            const { storage, chainStorage } =
                await deployMirroredStorage(session);
            await (await chainStorage.setValue(5n)).wait();

            expect(await storage.increment.staticCall()).to.equal(6n);
            expect(await storage.increment.staticCall()).to.equal(6n);

            expect(await storage.getValue()).to.equal(5n);
        });
    });

    it("keeps a returned sub-call's write out of the frame that reverted it", async function () {
        await withMirrorSession(async (session) => {
            const probe = await deployCommitProbe(session.signer);

            const answer = await session.provider.call({ to: probe });

            expect(BigInt(answer)).to.equal(0n);
            expect(BigInt(await session.chain.call({ to: probe }))).to.equal(
                0n
            );
            expect(nodeRequests(session, "eth_call")).to.have.length(0);
        });
    });

    it("sends estimateGas and reads at an older block to the node", async function () {
        await withMirrorSession(async (session) => {
            const { storage, address } = await deployMirroredStorage(session);
            await (await storage.setValue(5n)).wait();
            const older = (await headNumber(session)) - 1;
            const getValue = await storage.getValue.populateTransaction();
            const before = (method: string) =>
                nodeRequests(session, method).length;
            const estimates = before("eth_estimateGas");
            const calls = before("eth_call");
            const balances = before("eth_getBalance");

            await session.provider.estimateGas(getValue);
            await session.provider.call({ ...getValue, blockTag: older });
            await session.provider.getBalance(address, older);

            expect(before("eth_estimateGas")).to.equal(estimates + 1);
            expect(before("eth_call")).to.equal(calls + 1);
            expect(before("eth_getBalance")).to.equal(balances + 1);
        });
    });

    it("sends every read to the node without a storage diff service", async function () {
        await withMirrorSession(
            async (session) => {
                const { storage } = await deployMirroredStorage(session);

                expect(await storage.getValue()).to.equal(0n);

                expect(nodeRequests(session, "eth_call")).to.have.length(1);
            },
            { withoutService: true }
        );
    });

    it("sends a pending nonce read to the node and answers the latest one itself", async function () {
        await withMirrorSession(async (session) => {
            const address = session.wallet.address;

            const pending = await session.provider.getTransactionCount(
                address,
                "pending"
            );
            const latest = await session.provider.getTransactionCount(address);
            await session.provider.getTransactionCount(address);

            expect(latest).to.equal(pending);
            expect(
                nodeRequests(session, "eth_getTransactionCount").map(
                    (request) => (request.params as unknown[])[1]
                )
            ).to.deep.equal(["pending"]);
        });
    });

    it("records the included head from the catch-up and from a push", async function () {
        await withMirrorSession(
            async (session) => {
                const { storage } = await deployMirroredStorage(session);
                await storage.getValue();
                const head = await headNumber(session);
                const included = await session.chain.getBlock(head - 1);
                expect(session.provider.includedHead).to.deep.equal({
                    number: toQuantity(head - 1),
                    hash: included!.hash
                });

                await session.chain.send("evm_mine", []);

                await waitFor(
                    () =>
                        session.provider.includedHead?.number ===
                        toQuantity(head)
                );
            },
            { includedHead: new DepthIncludedHeadStrategy(1) }
        );
    });

    it("answers the chain id from its first answer without asking a node again", async function () {
        await withMirrorSession(async (session) => {
            // the provider's own network detection has asked once
            await session.provider.getNetwork();
            await session.provider.send("eth_chainId", []);
            await session.provider.send("eth_chainId", []);
            const asked = nodeRequests(session, "eth_chainId").length;

            await session.provider.send("eth_chainId", []);
            await session.provider.send("eth_chainId", []);

            expect(nodeRequests(session, "eth_chainId")).to.have.length(asked);
        });
    });

    it("answers the block number, blocks, transactions and receipts as the node does, without asking a node", async function () {
        await withMirrorSession(async (session) => {
            const { storage } = await deployMirroredStorage(session);
            const sent = await storage.setValue(5n);
            const receipt = await sent.wait();
            const head = await headNumber(session);
            const number = toQuantity(head);
            const blockReads = () =>
                nodeRequests(session, "eth_blockNumber").length +
                nodeRequests(session, "eth_getBlockByNumber").length +
                nodeRequests(session, "eth_getBlockByHash").length +
                nodeRequests(session, "eth_getTransactionByHash").length +
                nodeRequests(session, "eth_getTransactionReceipt").length;
            const before = blockReads();

            const answers = [
                await session.provider.send("eth_blockNumber", []),
                await session.provider.send("eth_getBlockByNumber", [
                    "latest",
                    true
                ]),
                await session.provider.send("eth_getBlockByNumber", [
                    number,
                    false
                ]),
                await session.provider.send("eth_getBlockByHash", [
                    receipt!.blockHash,
                    true
                ]),
                await session.provider.send("eth_getTransactionByHash", [
                    sent.hash
                ]),
                await session.provider.send("eth_getTransactionReceipt", [
                    sent.hash
                ])
            ];

            expect(answers).to.deep.equal([
                await session.chain.send("eth_blockNumber", []),
                await session.chain.send("eth_getBlockByNumber", [
                    "latest",
                    true
                ]),
                await session.chain.send("eth_getBlockByNumber", [
                    number,
                    false
                ]),
                await session.chain.send("eth_getBlockByHash", [
                    receipt!.blockHash,
                    true
                ]),
                await session.chain.send("eth_getTransactionByHash", [
                    sent.hash
                ]),
                await session.chain.send("eth_getTransactionReceipt", [
                    sent.hash
                ])
            ]);
            expect(blockReads()).to.equal(before);
        });
    });

    it("asks the node for a transaction, receipt or block the service does not hold", async function () {
        await withMirrorSession(async (session) => {
            const unknown = "0x" + "ab".repeat(32);
            const asked = (method: string) =>
                nodeRequests(session, method).length;
            const receipts = asked("eth_getTransactionReceipt");
            const blocks = asked("eth_getBlockByHash");

            expect(
                await session.provider.send("eth_getTransactionReceipt", [
                    unknown
                ])
            ).to.equal(null);
            expect(
                await session.provider.send("eth_getBlockByHash", [
                    unknown,
                    false
                ])
            ).to.equal(null);

            expect(asked("eth_getTransactionReceipt")).to.equal(receipts + 1);
            expect(asked("eth_getBlockByHash")).to.equal(blocks + 1);
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
