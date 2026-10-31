import { MiscountingBlockSource } from "../fixtures/node/MiscountingBlockSource";
import {
    RECORDED_ACCOUNT_INFO,
    withSubstrateNode,
    type SubstrateContract
} from "../fixtures/node/SubstrateChildTrieNode";
import { SDK_RPC_DEADLINE_MS } from "@/evm/p2pRuntime/rpcNodes/mirror/MirrorChain";
import { sleep } from "@/utils";
import { ChildTrieBlockSource } from "@/utils/node/storageDiff/backfillBlocks/ChildTrieBlockSource";
import { DepthIncludedHeadStrategy } from "@/utils/node/storageDiff/includedHead/DepthIncludedHeadStrategy";
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
    withMirrorSession,
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
import {
    AbiCoder,
    isError,
    toBeHex,
    toQuantity,
    ZeroAddress,
    ZeroHash
} from "ethers";
import path from "node:path";

/** Time is the input: how long a read that must wait is watched for. */
const ABSENCE_WINDOW_MS = 500;
const CUSTOM_PRECOMPILE_ADDRESS = "0x00000000000000000000000000000000000000f0";
const CUSTOM_PRECOMPILE_CALLDATA = "0x1234";

/**
 * Lets the mirror learn how long records take: blocks a node announces reach
 * the copy a few milliseconds later, each arrival a sample for the backstop.
 */
async function teachBackstop(
    session: MirrorSession,
    chainStorage: SimpleNumberStorage
): Promise<void> {
    await session.provider.getBalance(ZeroAddress);
    await session.provider.on("block", () => undefined);
    for (let value = 1n; value <= 3n; value++)
        await (await chainStorage.setValue(value)).wait();
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

    it("reads the first read of a slot the service has ready from the snapshot it pushed, with no scp_getState and no node read", async function () {
        await withMirrorSession(async (session) => {
            const { storage, address } = await deployMirroredStorage(session);
            await (await storage.setValue(5n)).wait();
            await backfillAtService(session, [address]);

            const word = await session.provider.getStorage(address, 0);

            expect(BigInt(word)).to.equal(5n);
            expect(serviceRequests(session, "scp_getState")).to.have.length(0);
            expect(nodeStateReads(session)).to.equal(0);
            expect(session.provider.mirrorStatistics).to.include({
                lazyReads: 0,
                snapshots: 1
            });
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
            expect(session.provider.mirrorStatistics).to.include({
                lazyReads: 0,
                snapshots: 1,
                snapshotTimeouts: 0
            });
        });
    });

    it("reads an account the service says is syncing at once, and answers locally once its snapshot has come", async function () {
        await withMirrorSession(async (session) => {
            const { storage, address } = await deployMirroredStorage(session);
            await (await storage.setValue(5n)).wait();
            const release = session.service.holdNotifications("scp_snapshot");

            const started = Date.now();
            const word = await session.provider.getStorage(address, 0);
            const elapsed = Date.now() - started;

            expect(BigInt(word)).to.equal(5n);
            expect(elapsed).to.be.lessThan(SDK_RPC_DEADLINE_MS / 4);
            expect(session.provider.mirrorStatistics).to.include({
                lazyReads: 1,
                snapshotTimeouts: 0,
                snapshots: 0
            });
            release();
            await waitFor(
                () => session.provider.mirrorStatistics?.snapshots === 1,
                5_000,
                20
            );
            // the code and the slot are local now: a contract call needs no lazy read
            expect(await storage.getValue()).to.equal(5n);
            expect(session.provider.mirrorStatistics?.lazyReads).to.equal(1);
        });
    });

    it("reads an account the service says is lazy at once, without waiting for a snapshot", async function () {
        await withMirrorSession(
            async (session) => {
                const { storage, address } =
                    await deployMirroredStorage(session);
                await (await storage.setValue(5n)).wait();
                await backfillAtService(session, [address]);
                // the notice is held back: the subscribe answer alone says lazy
                const release =
                    session.service.holdNotifications("scp_snapshot");

                const started = Date.now();
                const word = await session.provider.getStorage(address, 0);
                const elapsed = Date.now() - started;
                release();

                expect(BigInt(word)).to.equal(5n);
                expect(elapsed).to.be.lessThan(SDK_RPC_DEADLINE_MS / 4);
                expect(session.provider.mirrorStatistics).to.include({
                    snapshotTimeouts: 0,
                    snapshots: 0,
                    lazyReads: 1
                });
            },
            { backfillBlocks: new MiscountingBlockSource() }
        );
    });

    it("keeps an account lazy when the backfill of a syncing account ends without a snapshot", async function () {
        await withMirrorSession(
            async (session) => {
                const { storage, address } =
                    await deployMirroredStorage(session);
                await (await storage.setValue(5n)).wait();

                const word = await session.provider.getStorage(address, 0);
                await waitFor(
                    () => session.provider.mirrorStatistics?.lazyNotices === 1,
                    5_000,
                    20
                );

                expect(BigInt(word)).to.equal(5n);
                expect(session.provider.mirrorStatistics).to.include({
                    snapshots: 0,
                    snapshotTimeouts: 0
                });
                // still lazy: a slot the mirror has not read is asked for
                expect(await session.provider.getStorage(address, 1)).to.equal(
                    ZeroHash
                );
                expect(session.provider.mirrorStatistics).to.include({
                    lazyReads: 2,
                    snapshots: 0
                });
            },
            { backfillBlocks: new MiscountingBlockSource() }
        );
    });

    it("keeps an account lazy when the backfill of a syncing account fails", async function () {
        await withMirrorSession(async (session) => {
            const { storage, address } = await deployMirroredStorage(session);
            await (await storage.setValue(5n)).wait();
            // the service has staged the blocks; the backfill's own reads fail
            await sleep(500);
            session.relay.failNext("eth_getBlockByNumber", 50);

            const word = await session.provider.getStorage(address, 0);
            await waitFor(
                () => session.provider.mirrorStatistics?.lazyNotices === 1,
                10_000,
                20
            );

            expect(BigInt(word)).to.equal(5n);
            // still lazy: a slot the mirror has not read is asked for
            expect(await session.provider.getStorage(address, 1)).to.equal(
                ZeroHash
            );
            expect(session.provider.mirrorStatistics).to.include({
                lazyReads: 2,
                snapshots: 0,
                snapshotTimeouts: 0
            });
        });
    });

    it("asks the node, after a backstop learned from snapshot arrivals, for a snapshot the service has ready and never delivers", async function () {
        await withMirrorSession(async (session) => {
            const { address: taught } = await deployMirroredStorage(session);
            const { chainStorage, address } =
                await deployMirroredStorage(session);
            await (await chainStorage.setValue(3n)).wait();
            await backfillAtService(session, [taught, address]);
            expect(
                session.provider.mirrorStatistics?.snapshotBackstopMs
            ).to.equal(SDK_RPC_DEADLINE_MS);
            // a snapshot that arrives teaches how long snapshots take
            await session.provider.getStorage(taught, 0);
            expect(
                session.provider.mirrorStatistics?.snapshotBackstopMs
            ).to.be.lessThan(SDK_RPC_DEADLINE_MS / 2);
            session.service.dropNotifications("scp_snapshot");

            const started = Date.now();
            const word = await session.provider.getStorage(address, 0);
            const elapsed = Date.now() - started;

            expect(BigInt(word)).to.equal(3n);
            expect(elapsed).to.be.lessThan(SDK_RPC_DEADLINE_MS / 2);
            expect(session.provider.mirrorStatistics).to.include({
                snapshotTimeouts: 1,
                snapshotDelays: 0
            });
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
            // mirror follows without any snapshot having arrived
            const { address: warm } = await deployMirroredStorage(session);
            await session.provider.getStorage(warm, 0);
            await session.provider.on("block", () => undefined);
            for (let value = 1n; value <= 3n; value++)
                await (await chainStorage.setValue(value)).wait();
            await waitFor(
                () =>
                    (session.provider.mirrorStatistics?.backstopMs ??
                        SDK_RPC_DEADLINE_MS) <
                    SDK_RPC_DEADLINE_MS / 2,
                5_000,
                20
            );
            const blockBackstopMs =
                session.provider.mirrorStatistics!.backstopMs;
            expect(
                session.provider.mirrorStatistics?.snapshotBackstopMs,
                "no snapshot has arrived: the cap"
            ).to.equal(SDK_RPC_DEADLINE_MS);
            const release = session.service.holdNotifications("scp_snapshot");

            const read = session.provider.getStorage(address, 0);
            // time is the input: longer than a block takes by the learned bound
            await sleep(blockBackstopMs + ABSENCE_WINDOW_MS);
            release();
            const word = await read;

            // the last value teachBackstop wrote
            expect(BigInt(word)).to.equal(3n);
            expect(
                session.provider.mirrorStatistics?.snapshotTimeouts
            ).to.equal(0);
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
            const elapsed = Date.now() - started;

            // the node answers: far below the ceiling
            expect(BigInt(word)).to.equal(5n);
            expect(elapsed).to.be.lessThan(SDK_RPC_DEADLINE_MS / 2);
            expect(
                session.provider.mirrorStatistics?.snapshotTimeouts
            ).to.equal(0);
        });
    });

    it("re-asks the node about a sampled read after replying, and counts the match", async function () {
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
                await waitFor(
                    () => session.provider.mirrorStatistics?.sampleChecks === 1,
                    5_000,
                    20
                );
                expect(session.provider.mirrorStatistics).to.include({
                    sampleChecks: 1,
                    sampleMismatches: 0,
                    lazyDrops: 0
                });
                expect(nodeStateReads(session)).to.equal(1);
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
                    () => session.provider.mirrorStatistics?.sampleChecks === 3,
                    5_000,
                    20
                );

                expect(session.provider.mirrorStatistics).to.include({
                    sampleChecks: 3,
                    sampleMismatches: 0,
                    sampleSkipped: 0
                });
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
                expect(session.provider.mirrorStatistics).to.include({
                    sampleChecks: 0,
                    sampleSkipped: 0
                });
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
                        (session.provider.mirrorStatistics?.sampleChecks ?? 0) +
                            (session.provider.mirrorStatistics?.sampleSkipped ??
                                0) >
                        0,
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
                await waitFor(
                    () =>
                        session.provider.mirrorStatistics?.sampleMismatches ===
                        1,
                    5_000,
                    20
                );
                const right = await session.provider.getStorage(address, 0);

                expect(BigInt(wrong)).to.equal(6n);
                expect(BigInt(right)).to.equal(5n);
                expect(session.provider.mirrorStatistics).to.include({
                    sampleMismatches: 1,
                    lazyDrops: 1
                });
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
                await waitFor(
                    () =>
                        session.provider.mirrorStatistics?.sampleMismatches ===
                        1,
                    5_000,
                    20
                );
                const right = await storage.getValue();

                expect([wrong, right]).to.deep.equal([6n, 5n]);
                expect(session.provider.mirrorStatistics).to.include({
                    sampleChecks: 1,
                    lazyDrops: 1
                });
            },
            { sampleRate: 1 }
        );
    });

    it("drops a complete account to lazy reads when the service finds its cached entries short after a block, and reads the omitted slot", async function () {
        let omitFrom = Number.MAX_SAFE_INTEGER;
        const contract: SubstrateContract = {
            address: "",
            changes: [],
            deployed: 0,
            tipNumber: -1,
            tipHash: () => "0xtip",
            info: RECORDED_ACCOUNT_INFO,
            entries: (n) => (n >= omitFrom ? 3 : 2)
        };
        await withSubstrateNode(contract, async (substrate) => {
            await withMirrorSession(
                async (session) => {
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
                    expect(
                        session.provider.mirrorStatistics?.snapshots
                    ).to.equal(1);

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
                    await waitFor(
                        () =>
                            session.provider.mirrorStatistics?.lazyDrops === 1,
                        5_000,
                        20
                    );

                    // a complete cache would answer zero for the slot the trace left out
                    expect(
                        BigInt(await session.provider.getStorage(writer, 3))
                    ).to.equal(9n);
                    expect(session.provider.mirrorStatistics).to.include({
                        lazyNotices: 1,
                        lazyDrops: 1
                    });
                },
                { backfillBlocks: new ChildTrieBlockSource(substrate.url) }
            );
        });
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
            expect(session.provider.mirrorStatistics).to.include({
                lazyReads: 1,
                lazyFields: 1,
                snapshotTimeouts: 0
            });
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

    it("runs a custom precompile locally without an upstream request", async function () {
        await withMirrorSession(
            async (session) => {
                const call = async () =>
                    AbiCoder.defaultAbiCoder().decode(
                        ["uint256", "bool"],
                        await session.provider.call({
                            to: CUSTOM_PRECOMPILE_ADDRESS,
                            data: CUSTOM_PRECOMPILE_CALLDATA
                        })
                    );
                const [first] = await call();
                expect(first).to.equal(7n);
                expect(nodeRequests(session, "eth_call")).to.have.length(0);
                const sent = session.node.forwardedMethods.length;

                const [second] = await call();

                expect(second).to.equal(7n);
                expect(session.node.forwardedMethods.slice(sent)).to.deep.equal(
                    []
                );
            },
            {
                customPrecompiles: [
                    {
                        address: CUSTOM_PRECOMPILE_ADDRESS,
                        module: path.join(
                            __dirname,
                            "../fixtures/workerAnswerPrecompile.ts"
                        ),
                        options: {
                            expectedData: CUSTOM_PRECOMPILE_CALLDATA,
                            value: "7"
                        }
                    }
                ]
            }
        );
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
            expect(
                session.provider.mirrorStatistics?.snapshots
            ).to.be.greaterThan(0);
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
            await waitFor(
                () =>
                    (session.provider.mirrorStatistics?.backstopMs ??
                        SDK_RPC_DEADLINE_MS) < SDK_RPC_DEADLINE_MS,
                5_000,
                20
            );
            const release =
                session.service.holdNotifications("scp_subscription");

            await (await storage.setValue(7n)).wait();
            const started = Date.now();
            const value = await storage.getValue();
            const elapsed = Date.now() - started;

            expect(value, "the node's value, not the copy's older 2").to.equal(
                7n
            );
            expect(elapsed).to.be.lessThan(SDK_RPC_DEADLINE_MS);
            expect(nodeRequests(session, "eth_call")).to.have.length(1);
            expect(session.provider.mirrorStatistics).to.include({
                freshnessTimeouts: 1
            });

            // the wait is not repeated for every read: the node answers at once
            expect(await storage.getValue()).to.equal(7n);
            expect(nodeRequests(session, "eth_call")).to.have.length(2);
            expect(session.provider.mirrorStatistics).to.include({
                freshnessTimeouts: 1,
                behindNode: 1
            });

            // once the record arrives the copy answers again
            release();
            await waitFor(async () => {
                const asked = nodeRequests(session, "eth_call").length;
                await storage.getValue();
                return nodeRequests(session, "eth_call").length === asked;
            }, 5_000);
        });
    });

    it("has the SDK's RPC deadline as its backstop until a block has reached the copy, and a shorter one after fast blocks", async function () {
        await withMirrorSession(async (session) => {
            const { storage, chainStorage } =
                await deployMirroredStorage(session);
            expect(session.provider.mirrorStatistics?.backstopMs).to.equal(
                SDK_RPC_DEADLINE_MS
            );
            expect(await storage.getValue()).to.equal(0n);
            expect(session.provider.mirrorStatistics?.backstopMs).to.equal(
                SDK_RPC_DEADLINE_MS
            );

            await teachBackstop(session, chainStorage);

            await waitFor(
                () =>
                    (session.provider.mirrorStatistics?.backstopMs ??
                        SDK_RPC_DEADLINE_MS) <
                    SDK_RPC_DEADLINE_MS / 2,
                5_000,
                20
            );
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
            expect(session.provider.mirrorStatistics).to.include({
                freshnessTimeouts: 0,
                behindNode: 1
            });
        });
    });

    it("asks the node at once when the service says its upstream has not seen the awaited block", async function () {
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
            const started = Date.now();
            const read = storage.getValue();
            await sleep(50);
            // a read of the service that names the block makes it check its upstream
            const number = await session.provider.send("eth_blockNumber", []);
            const value = await read;

            expect(value).to.equal(3n);
            expect(number).to.equal(toQuantity(await headNumber(session)));
            expect(Date.now() - started).to.be.lessThan(
                SDK_RPC_DEADLINE_MS / 2
            );
            expect(nodeRequests(session, "eth_call")).to.have.length(1);
            expect(session.provider.mirrorStatistics).to.include({
                freshnessTimeouts: 0,
                behindNode: 1
            });
            held.release();
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
            expect(session.provider.mirrorStatistics).to.include({
                freshnessTimeouts: 0
            });
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

    it("asks the node at once when the service says a snapshot it promised as ready is delayed", async function () {
        await withMirrorSession(
            async (session) => {
                const { chainStorage, address } =
                    await deployMirroredStorage(session);
                await (await chainStorage.setValue(5n)).wait();
                await backfillAtService(session, [address]);
                await session.provider.getBalance(ZeroAddress);
                await session.chain.send("anvil_mine", [3]);
                session.service.dropNotifications("scp_snapshot");

                const started = Date.now();
                const read = session.provider.getStorage(address, 0);
                await sleep(ABSENCE_WINDOW_MS);
                // a reorganization of the whole retained window clears the service's cache
                await session.chain.send("anvil_reorg", [2, []]);
                await session.chain.send("evm_mine", []);
                const word = await read;

                expect(BigInt(word)).to.equal(5n);
                expect(Date.now() - started).to.be.lessThan(
                    SDK_RPC_DEADLINE_MS
                );
                expect(session.provider.mirrorStatistics).to.include({
                    snapshotDelays: 1,
                    snapshotTimeouts: 0
                });
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
            expect(Date.now() - started).to.be.lessThan(SDK_RPC_DEADLINE_MS);
            expect(nodeRequests(session, "eth_call")).to.have.length(1);
            expect(session.provider.mirrorStatistics).to.include({
                freshnessTimeouts: 0,
                behindNode: 1
            });
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
